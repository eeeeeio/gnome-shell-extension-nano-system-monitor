const {GObject, Gtk, Gdk} = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Settings = Me.imports.settings;

const WIDGET_TEMPLATE_FILE = Gtk.get_major_version() === 3 ? 'prefs_gtk3.ui' : 'prefs.ui';

const N_ = function (e) {
  return e;
};

const colorToHex = (color) => {
  return N_('#%02x%02x%02x').format(
    255 * color.red,
    255 * color.green,
    255 * color.blue,
  );
}

const NanoSystemMonitorPrefsWidget = GObject.registerClass({
  GTypeName: 'NanoSystemMonitorPrefsWidget',
  Template: Me.dir.get_child(WIDGET_TEMPLATE_FILE).get_uri(),
  InternalChildren: [
    'net_speed_enable_switch',
    'cpu_temp_enable_switch',
    'refresh_interval',
    'font_button',
    'text_color'
  ]
}, class NanoSystemMonitorPrefsWidget extends Gtk.Box {
  _init(prefs) {
    super._init({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 30
    });
    this._configuration = prefs;

    this.update_widget_setting_values();
  }
  update_widget_setting_values() {
    this._net_speed_enable_switch.set_active(this._configuration.IS_NET_SPEED_ENABLE.get());
    this._cpu_temp_enable_switch.set_active(this._configuration.IS_CPU_TEMP_ENABLE.get());
    this._refresh_interval.set_value(this._configuration.REFRESH_INTERVAL.get());
    this._font_button.set_font(`${this._configuration.FONT_FAMILY.get()} ${this._configuration.FONT_SIZE.get()}`);
    const color = new Gdk.RGBA();
    color.parse(this._configuration.TEXT_COLOR.get());
    this._text_color.set_rgba(color);
  }

  color_changed(widget) {
    this._configuration.TEXT_COLOR.set(colorToHex(widget.get_rgba()));
  }

  font_changed(widget) {
    const font = widget.get_font();
    const lastSpaceIndex = font.lastIndexOf(' ');
    const fontFamily = font.substring(0, lastSpaceIndex);
    const fontSize = font.substring(lastSpaceIndex, font.length);
    this._configuration.FONT_FAMILY.set(fontFamily);
    this._configuration.FONT_SIZE.set(fontSize);
  }

  net_speed_enable_switch_changed(widget) {
    this._configuration.IS_NET_SPEED_ENABLE.set(widget.get_active());
  }

  cpu_temp_enable_switch_changed(widget) {
    this._configuration.IS_CPU_TEMP_ENABLE.set(widget.get_active());
  }

  refresh_interval_changed(widget) {
    this._configuration.REFRESH_INTERVAL.set(widget.get_value());
  }
});

function init() {
}

function buildPrefsWidget() {
  let prefs = new Settings.Prefs();
  const widget = new NanoSystemMonitorPrefsWidget(prefs);
  widget.homogeneous = true;
  if (Gtk.get_major_version() === 3) {
    widget.show_all();
  }
  return widget;
}
