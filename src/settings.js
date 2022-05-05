const ExtensionUtils = imports.misc.extensionUtils;

const SETTING_SCHEMA = 'org.gnome.shell.extensions.nano-system-monitor';

var Prefs = class Prefs {
  constructor() {
    const settings = ExtensionUtils.getSettings(SETTING_SCHEMA);

    this.LABEL_TEXT = new PrefValue(settings, 'label-text', 'string');
    this.IS_LABEL_ENABLE = new PrefValue(settings, 'is-label-enable', 'boolean');
    this.IS_NET_SPEED_ENABLE = new PrefValue(settings, 'is-net-speed-enable', 'boolean');
    this.IS_CPU_TEMP_ENABLE = new PrefValue(settings, 'is-cpu-temp-enable', 'boolean');
    this.IS_FAN_SPEED_ENABLE = new PrefValue(settings, 'is-fan-speed-enable', 'boolean');
    this.FAN_NUMBER = new PrefValue(settings, 'fan-number', 'int');
    this.REFRESH_INTERVAL = new PrefValue(settings, 'refresh-interval', 'int');
    this.FONT_FAMILY = new PrefValue(settings, 'font-family', 'string');
    this.FONT_SIZE = new PrefValue(settings, 'font-size', 'string');
    this.TEXT_COLOR = new PrefValue(settings, 'text-color', 'string');
  }
}

class PrefValue {
  constructor(gioSettings, key, type) {
    this._gioSettings = gioSettings;
    this._key = key;
    this._type = type;
    this._changedListenerId = -1;
  }

  get() {
    return this._gioSettings[`get_${this._type}`](this._key);
  }

  set(v) {
    return this._gioSettings[`set_${this._type}`](this._key, v);
  }

  changed(callback) {
    this._changedListenerId = this._gioSettings.connect(`changed::${this._key}`, callback);
    return this._changedListenerId;
  }

  disconnect() {
    if (this._changedListenerId > 0) {
      this._gioSettings.disconnect(this._changedListenerId);
    }
  }
}
