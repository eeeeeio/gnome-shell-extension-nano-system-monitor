/* extension.js
 *
 * This is a fork of <https://extensions.gnome.org/extension/4478/net-speed/>.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const {GObject, St, Clutter, GLib, Gio, Shell} = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const ByteArray = imports.byteArray;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Settings = Me.imports.settings;
const Util = imports.misc.util;

const netSpeedUnits = ["K", "M", "G", "T", "P/s", "E/s", "Z/s", "Y/s"];

let lastTotalNetDownBytes = 0;
let lastTotalNetUpBytes = 0;

let lastCPUUsed = 0;
let lastCPUTotal = 0;

const ColorMap = ["#D154A9", "#FD5369", "#FB7F3A", "#FFB00C", "#a3d726", "#68BF60"];
const LevelNumberMap = [100, 90, 80, 70, 60, 50];
let fontFamilyG = "";
let fontSizeG = "";
let textColorG = "";

// See <https://github.com/AlynxZhou/gnome-shell-extension-net-speed>.
const getCurrentNetSpeed = refreshInterval => {
  const netSpeed = {down: 0, up: 0};

  try {
    const inputFile = Gio.File.new_for_path("/proc/net/dev");
    const fileInputStream = inputFile.read(null);
    // See <https://gjs.guide/guides/gobject/basics.html#gobject-construction>.
    // If we want new operator, we need to pass params in object.
    // Short param is only used for static constructor.
    const dataInputStream = new Gio.DataInputStream({
      base_stream: fileInputStream
    });

    // Caculate the sum of all interfaces' traffic line by line.
    let totalDownBytes = 0;
    let totalUpBytes = 0;
    let line = null;
    let length = 0;

    // See <https://gjs-docs.gnome.org/gio20~2.66p/gio.datainputstream#method-read_line>.
    while (([line, length] = dataInputStream.read_line(null)) && line != null) {
      // See <https://github.com/GNOME/gjs/blob/master/doc/ByteArray.md#tostringauint8array-encodingstringstring>.
      // It seems Uint8Array is only returned at the first time.
      if (line instanceof Uint8Array) {
        line = ByteArray.toString(line).trim();
      } else {
        line = line.toString().trim();
      }
      const fields = line.split(/\W+/);
      if (fields.length <= 2) {
        break;
      }

      // Skip virtual interfaces.
      const networkInterface = fields[0];
      const currentInterfaceDownBytes = Number.parseInt(fields[1]);
      const currentInterfaceUpBytes = Number.parseInt(fields[9]);
      if (
        networkInterface == "lo" ||
        // Created by python-based bandwidth manager "traffictoll".
        networkInterface.match(/^ifb[0-9]+/) ||
        // Created by lxd container manager.
        networkInterface.match(/^lxdbr[0-9]+/) ||
        networkInterface.match(/^virbr[0-9]+/) ||
        networkInterface.match(/^br[0-9]+/) ||
        networkInterface.match(/^vnet[0-9]+/) ||
        networkInterface.match(/^tun[0-9]+/) ||
        networkInterface.match(/^tap[0-9]+/) ||
        isNaN(currentInterfaceDownBytes) ||
        isNaN(currentInterfaceUpBytes)
      ) {
        continue;
      }

      totalDownBytes += currentInterfaceDownBytes;
      totalUpBytes += currentInterfaceUpBytes;
    }

    fileInputStream.close(null);

    if (lastTotalNetDownBytes === 0) {
      lastTotalNetDownBytes = totalDownBytes;
    }
    if (lastTotalNetUpBytes === 0) {
      lastTotalNetUpBytes = totalUpBytes;
    }

    netSpeed["down"] =
      (totalDownBytes - lastTotalNetDownBytes) / refreshInterval;
    netSpeed["up"] = (totalUpBytes - lastTotalNetUpBytes) / refreshInterval;

    lastTotalNetDownBytes = totalDownBytes;
    lastTotalNetUpBytes = totalUpBytes;
  } catch (e) {
    logError(e);
  }

  return netSpeed;
};

// See <https://stackoverflow.com/a/9229580>.
const getCurrentCPUUsage = () => {
  let currentCPUUsage = 0;

  try {
    const inputFile = Gio.File.new_for_path("/proc/stat");
    const fileInputStream = inputFile.read(null);
    const dataInputStream = new Gio.DataInputStream({
      base_stream: fileInputStream
    });

    let currentCPUUsed = 0;
    let currentCPUTotal = 0;
    let line = null;
    let length = 0;

    while (([line, length] = dataInputStream.read_line(null)) && line != null) {
      if (line instanceof Uint8Array) {
        line = ByteArray.toString(line).trim();
      } else {
        line = line.toString().trim();
      }

      const fields = line.split(/\W+/);

      if (fields.length < 2) {
        continue;
      }

      const itemName = fields[0];
      if (itemName == "cpu" && fields.length >= 5) {
        const user = Number.parseInt(fields[1]);
        const system = Number.parseInt(fields[3]);
        const idle = Number.parseInt(fields[4]);
        currentCPUUsed = user + system;
        currentCPUTotal = user + system + idle;
        break;
      }
    }

    fileInputStream.close(null);

    // Avoid divide by zero
    if (currentCPUTotal - lastCPUTotal !== 0) {
      currentCPUUsage =
        (currentCPUUsed - lastCPUUsed) / (currentCPUTotal - lastCPUTotal);
    }

    lastCPUTotal = currentCPUTotal;
    lastCPUUsed = currentCPUUsed;
  } catch (e) {
    logError(e);
  }
  return currentCPUUsage;
};

const getCurrentMemoryUsage = () => {
  let currentMemoryUsage = 0;
  let currentSwapMemoryUsage = 0;

  try {
    const inputFile = Gio.File.new_for_path("/proc/meminfo");
    const fileInputStream = inputFile.read(null);
    const dataInputStream = new Gio.DataInputStream({
      base_stream: fileInputStream
    });

    let memTotal = -1;
    let memAvailable = -1;
    let SwapTotal = -1;
    let SwapFree = -1;
    let line = null;
    let length = 0;

    while (([line, length] = dataInputStream.read_line(null)) && line != null) {
      if (line instanceof Uint8Array) {
        line = ByteArray.toString(line).trim();
      } else {
        line = line.toString().trim();
      }

      const fields = line.split(/\W+/);

      if (fields.length < 2) {
        break;
      }

      const itemName = fields[0];
      const itemValue = Number.parseInt(fields[1]);

      if (itemName == "MemTotal") {
        memTotal = itemValue;
      }

      if (itemName == "MemAvailable") {
        memAvailable = itemValue;
      }

      if (itemName == "SwapTotal") {
        SwapTotal = itemValue;
      }

      if (itemName == "SwapFree") {
        SwapFree = itemValue;
      }

      if (memTotal !== -1 && memAvailable !== -1 && SwapTotal !== -1 && SwapFree !== -1) {
        break;
      }
    }

    fileInputStream.close(null);

    if (memTotal !== -1 && memAvailable !== -1) {
      const memUsed = memTotal - memAvailable;
      currentMemoryUsage = memUsed / memTotal;
    }
    if (SwapTotal !== -1 && SwapFree !== -1) {
      const memUsed = SwapTotal - SwapFree;
      currentSwapMemoryUsage = memUsed / SwapTotal;
    }
  } catch (e) {
    logError(e);
  }
  return {
    currentMemoryUsage,
    currentSwapMemoryUsage
  };
};

function spawnCommandLine(command_line) {
  return new Promise((rec, rej) => {
    try {
      let proc = new Gio.Subprocess({argv: command_line, flags: Gio.SubprocessFlags.STDOUT_PIPE});
      proc.init(null);
      proc.communicate_utf8_async(null, null, (p, result) => {
        let [ok, output,] = p.communicate_utf8_finish(result);
        rec(output)
      });
    } catch (err) {
      log(err);
    }
  })
}

//  sensorsGetTemp
const sensorsGetTemp = async () => {
  try {
    let resCommandLine = await spawnCommandLine(["sensors", "-j"]);
    if (resCommandLine) {
      let res = JSON.parse(resCommandLine);
      let coreStr = Object.keys(res).filter(v => v.match("coretemp"));
      if (coreStr) {
        let tempStr = Object.keys(res[coreStr]).filter(v => v.match("Package"));
        return res[coreStr][tempStr].temp1_input;
      }
    }
  } catch (e) {
    logError(e);
  }
  return 0;
};

//  /sys/class/hwmon/hwmon2/fan1_input


//  getTemp
const getTemp = async () => {
  try {
    const inputFile = Gio.File.new_for_path("/sys/class/hwmon/hwmon1/temp1_input");
    const fileInputStream = inputFile.read(null);
    const dataInputStream = new Gio.DataInputStream({
      base_stream: fileInputStream
    });

    let line = 0;
    let length = 0;

    [line, length] = dataInputStream.read_line(null)

    if (line instanceof Uint8Array) {
      line = ByteArray.toString(line).trim();
    } else {
      line = line.toString().trim();
    }

    return parseInt(parseInt(line) / 1000);

  } catch (e) {
    logError(e);
  }
  return 0;
};

const getFan = async (numb) => {
  try {
    const inputFile = Gio.File.new_for_path(`/sys/class/hwmon/hwmon2/fan${numb}_input`);
    const fileInputStream = inputFile.read(null);
    const dataInputStream = new Gio.DataInputStream({
      base_stream: fileInputStream
    });

    let line = 0;
    let length = 0;

    [line, length] = dataInputStream.read_line(null)

    if (line instanceof Uint8Array) {
      line = ByteArray.toString(line).trim();
    } else {
      line = line.toString().trim();
    }

    if(isNaN(line)){
      return -1;
    }
    return parseInt(line);

  } catch (e) {
    return -1;
    // logError(e);
  }
  return 0;
};

const formatNetSpeedWithUnit = amount => {
  let unitIndex = 0;
  amount /= 1000;
  while (amount >= 1000 && unitIndex < netSpeedUnits.length - 1) {
    amount /= 1000;
    ++unitIndex;
  }

  let digits = 0;
  // Instead of showing 0.00123456 as 0.00, show it as 0.
  if (amount >= 100 || amount - 0 < 0.01) {
    // 100 M/s, 200 K/s, 300 B/s.
    digits = 0;
  } else if (amount >= 10) {
    // 10.1 M/s, 20.2 K/s, 30.3 B/s.
    digits = 1;
  } else {
    // 1.01 M/s, 2.02 K/s, 3.03 B/s.
    digits = 2;
  }

  // See <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed>.
  return `${amount
    .toFixed(digits)
    .toString()
    .padStart(4, " ")} ${netSpeedUnits[unitIndex]}`;
};

// Format a usage value in [0, 1] as an integer percent value.
const formatUsageVal = usage => {
  return (
    Math.round(usage * 100)
      .toString()
      .padStart(2)
  );
  // return (
  //   Math.round(usage * 100)
  //     .toString()
  //     .padStart(2) + "%"
  // );
};

const toDisplayString = (
  texts,
  enable,
  cpuUsage,
  memoryUsage,
  memorySwapUsage,
  currentTemp,
  netSpeed,
  fanSpeed,
) => {
  let randerTexts = [];
  try {
    randerTexts = texts ? texts.split("|").map(v => v.trim()) : [];
  } catch (e) {
    logErr(e);
  }
  return {
    per: [
      formatUsageVal(cpuUsage),
      formatUsageVal(memoryUsage),
      formatUsageVal(memorySwapUsage),
    ],
    net: netSpeed ?
      ` - ${enable.isLabelEnable ? `${randerTexts[3]} ` : ""}${formatNetSpeedWithUnit(netSpeed["down"])} | ${enable.isLabelEnable ? `${randerTexts[4]} ` : ""}${formatNetSpeedWithUnit(
        netSpeed["up"]
      )} - ` : null,
    temp: currentTemp ? `${enable.isLabelEnable ? randerTexts[5] : ""}${currentTemp}` : null,
    fan: isNaN(fanSpeed) ? null: `${enable.isLabelEnable ? randerTexts[6] : ""}${fanSpeed}`,
  }


};

const Indicator = GObject.registerClass(
  class Indicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, "Simple System Monitor");

      const box = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER, style: "height:20px"});

      this._barGauge = [
        new St.BoxLayout({
          y_align: Clutter.ActorAlign.END,
          style: "width:15px;height:10px;background:#666;border-radius:2px",
        }),
        new St.BoxLayout({
          y_align: Clutter.ActorAlign.END,
          style: "width:15px;height:10px;background:#666;border-radius:2px",
        }),
        new St.BoxLayout({
          y_align: Clutter.ActorAlign.END,
          style: "width:15px;height:10px;background:#666;border-radius:2px",
        }),
      ]
      this._barText = [
        new St.Label({
          y_align: Clutter.ActorAlign.CENTER,
          text: ""
        }),
        new St.Label({
          y_align: Clutter.ActorAlign.CENTER,
          text: ""
        }),
        new St.Label({
          y_align: Clutter.ActorAlign.CENTER,
          text: ""
        }),
      ]
      this._net = new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        text: "Initialization"
      });
      this._temp = new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        text: ""
      });
      this._fan = new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        text: ""
      });


      this._label = [
        this._barText[0],
        this._barGauge[0],
        this._barText[1],
        this._barGauge[1],
        this._barText[2],
        this._barGauge[2],
        this._net,
        this._temp,
        this._fan,
        // new St.Label({
        //   y_align: Clutter.ActorAlign.CENTER,
        //   text: "Initialization"
        // }),
      ];
      // this._label = new St.Label({
      //   y_align: Clutter.ActorAlign.CENTER,
      //   text: "Initialization"
      // });
      this._label.forEach((v, i) => {
        box.add_child(this._label[i]);
      })

      this.add_child(box);


      let systemItem = new PopupMenu.PopupMenuItem("System monitor");
      let _appSys = Shell.AppSystem.get_default();
      let _gsmApp = _appSys.lookup_app('gnome-system-monitor.desktop');
      systemItem.connect("activate", () => {
        _gsmApp.activate();
      });
      this.menu.addMenuItem(systemItem);

      let settingMenuItem = new PopupMenu.PopupMenuItem("Setting");
      settingMenuItem.connect("activate", () => {
        if (typeof ExtensionUtils.openPrefs === "function") {
          ExtensionUtils.openPrefs();
        } else {
          Util.spawn(["gnome-shell-extension-prefs", Me.uuid]);
        }
      });
      this.menu.addMenuItem(settingMenuItem);
    }

    setFontStyle(fontFamily, fontSize, textColor) {
      // this._label.forEach((v)=>{
      //   v.set_style(
      //     `font-family: "${fontFamily}";font-size: ${fontSize}px; color: ${textColor};`
      //   );
      // })
      fontFamilyG = fontFamily;
      fontSizeG = fontSize;
      textColorG = textColor;
      this._net.set_style(
        `font-family: "${fontFamily}";font-size: ${fontSize}px; color: ${textColor}`
      );
      // this._label[4].set_style(
      //   `font-family: "${fontFamily}";font-size: ${fontSize}px; color: ${textColor};`
      // );
    }

    setLabelText(textList, enable) {
      this._barText.forEach((v, i) => {
        this._barText[i].set_text(enable ? (textList[i] || "") : "");
      })
    }

    rander(textObj) {
      // this._label.forEach((v)=>{
      //   v.set_text(text);
      // })
      try {
        textObj.per.forEach((v, i) => {
          let bg = ColorMap[5];
          for (let a = 0; a < LevelNumberMap.length - 1; a++) {
            if (v >= LevelNumberMap[a]) {
              bg = ColorMap[a];
              break;
            }
          }
          this._barGauge[i].set_style(
            `width:15px;height:${parseInt(v / 5)}px;background:${bg};border-radius:2px;margin:auto 5px`
          );
        })

        this._net.set_text(textObj.net ? textObj.net : "");
        let tempBg = textColorG;
        for (let a = 0; a < LevelNumberMap.length - 1; a++) {
          if (textObj.temp >= LevelNumberMap[a]) {
            tempBg = ColorMap[a];
            break;
          }
        }
        this._temp.set_text(textObj.temp ? ` ${textObj.temp}°C ` : "");
        // this._label[3].set_style(
        //   `font-family: "${fontFamilyG}";font-size: ${fontSizeG}px; color: ${textColorG}`
        // );
        this._temp.set_style(
          `font-family: "${fontFamilyG}";font-size: ${fontSizeG}px; color: ${tempBg}`
        );
        this._fan.set_text(textObj.fan ? ` ${textObj.fan}/s ` : "");
      } catch (e) {
        logError(e);
      }
      // this._label[1].set_text(text);
    }
  }
);

class Extension {
  constructor(uuid) {
    this._uuid = uuid;
  }

  enable() {
    lastTotalNetDownBytes = 0;
    lastTotalNetUpBytes = 0;

    lastCPUUsed = 0;
    lastCPUTotal = 0;

    this._prefs = new Settings.Prefs();

    this._texts = {
      label: this._prefs.LABEL_TEXT.get() || "",
    };

    this._enable = {
      isLabelEnable: this._prefs.IS_LABEL_ENABLE.get(),
      isFanSpeedEnable: this._prefs.IS_FAN_SPEED_ENABLE.get(),
      isNetSpeedEnable: this._prefs.IS_NET_SPEED_ENABLE.get(),
      isCpuTempEnable: this._prefs.IS_CPU_TEMP_ENABLE.get(),
    };

    this._fan_number = this._prefs.FAN_NUMBER.get();
    this._refresh_interval = this._prefs.REFRESH_INTERVAL.get();

    this._indicator = new Indicator();

    this._update_text_style();
    this._update_label();

    Main.panel.addToStatusArea(this._uuid, this._indicator, 0, "right");

    this._timeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT_IDLE,
      this._refresh_interval,
      this._refresh_monitor.bind(this)
    );

    this._listen_setting_change();
  }

  disable() {
    this._destory_setting_change_listener();
    if (this._indicator != null) {
      this._indicator.destroy();
      this._indicator = null;
    }
    this._prefs = null;
    this._texts = null;
    this._enable = null;
    this._refresh_interval = null;
    this._fan_number = null;
    if (this._timeout != null) {
      GLib.source_remove(this._timeout);
      this._timeout = null;
    }
  }

  _update_text_style() {
    this._indicator.setFontStyle(
      this._prefs.FONT_FAMILY.get(),
      this._prefs.FONT_SIZE.get(),
      this._prefs.TEXT_COLOR.get()
    );
  }

  _update_label() {
    let randerTexts = [];
    try {
      randerTexts = this._texts.label ? this._texts.label.split("|").map(v => v.trim()) : [];
    } catch (e) {
      logErr(e);
    }
    this._indicator.setLabelText(randerTexts, this._enable.isLabelEnable);
  }

  async _refresh_monitor() {
    let currentCPUUsage = null;
    let currentFanSpeed = null;
    let currentMemoryUsage = null;
    let currentNetSpeed = null;
    let currentMemorySwapUsage = null;
    let currentTemp = null;
    currentCPUUsage = getCurrentCPUUsage(this._refresh_interval);
    let memoryUsage = getCurrentMemoryUsage();
    currentMemoryUsage = memoryUsage.currentMemoryUsage;
    currentMemorySwapUsage = memoryUsage.currentSwapMemoryUsage;
    if (this._enable.isFanSpeedEnable) {
      currentFanSpeed = await getFan(this._fan_number);
    }
    if (this._enable.isNetSpeedEnable) {
      currentNetSpeed = getCurrentNetSpeed(this._refresh_interval);
    }
    if (this._enable.isCpuTempEnable) {
      currentTemp = await getTemp();
    }

    const displayText = toDisplayString(
      this._texts.label,
      this._enable,
      currentCPUUsage,
      currentMemoryUsage,
      currentMemorySwapUsage,
      currentTemp,
      currentNetSpeed,
      currentFanSpeed,
    );
    this._indicator.rander(displayText);
    // this._indicator.setText(displayText);
    return GLib.SOURCE_CONTINUE;
  }

  _listen_setting_change() {
    this._prefs.IS_LABEL_ENABLE.changed(() => {
      this._enable.isLabelEnable = this._prefs.IS_LABEL_ENABLE.get();
      this._update_label();
    });
    this._prefs.IS_FAN_SPEED_ENABLE.changed(() => {
      this._enable.isFanSpeedEnable = this._prefs.IS_FAN_SPEED_ENABLE.get();
    });
    this._prefs.IS_NET_SPEED_ENABLE.changed(() => {
      this._enable.isNetSpeedEnable = this._prefs.IS_NET_SPEED_ENABLE.get();
    });
    this._prefs.IS_CPU_TEMP_ENABLE.changed(() => {
      this._enable.isCpuTempEnable = this._prefs.IS_CPU_TEMP_ENABLE.get();
    });

    this._prefs.LABEL_TEXT.changed(() => {
      this._texts.label = this._prefs.LABEL_TEXT.get() || "";
      this._update_label();
    });
    this._prefs.FONT_FAMILY.changed(() => this._update_text_style());
    this._prefs.FONT_SIZE.changed(() => this._update_text_style());
    this._prefs.TEXT_COLOR.changed(() => this._update_text_style());

    this._prefs.FAN_NUMBER.changed(() => {
      this._fan_number = this._prefs.FAN_NUMBER.get();
    });

    this._prefs.REFRESH_INTERVAL.changed(() => {
      this._refresh_interval = this._prefs.REFRESH_INTERVAL.get();
      if (this._timeout != null) {
        GLib.source_remove(this._timeout);
      }
      this._timeout = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT_IDLE,
        this._refresh_interval,
        this._refresh_monitor.bind(this)
      );
    });
  }

  _destory_setting_change_listener() {
    this._prefs.IS_LABEL_ENABLE.disconnect();
    this._prefs.IS_FAN_SPEED_ENABLE.disconnect();
    this._prefs.LABEL_TEXT.disconnect();
    this._prefs.FAN_NUMBER.disconnect();
    this._prefs.IS_NET_SPEED_ENABLE.disconnect();
    this._prefs.IS_CPU_TEMP_ENABLE.disconnect();
    this._prefs.REFRESH_INTERVAL.disconnect();
    this._prefs.FONT_FAMILY.disconnect();
    this._prefs.FONT_SIZE.disconnect();
    this._prefs.TEXT_COLOR.disconnect();
  }
}

function init(meta) {
  return new Extension(meta.uuid);
}
