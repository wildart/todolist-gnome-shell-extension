// Authors:
// * Baptiste Saleil http://bsaleil.org/
// * Community: https://github.com/bsaleil/todolist-gnome-shell-extension/network
// With code from: https://github.com/vibou/vibou.gTile
//
// Licence: GPLv2+

const St = imports.gi.St;
const Gtk = imports.gi.Gtk;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Shell = imports.gi.Shell;
const Meta = imports.gi.Meta;
const GObject = imports.gi.GObject;

const Gettext = imports.gettext;
const _ = Gettext.domain('todolist').gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Utils = ExtensionUtils.getCurrentExtension().imports.utils;
const ExtensionSettings = Utils.getSettings(); // Get settings from utils.js

const MAX_LENGTH = 100;
const KEY_RETURN = 65293;
const KEY_ENTER  = 65421;
const BASE_TASKS = '[{"list": "My List", "todo": ["Task 1"], "done": [] }]';

const Clipboard = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

const LIST_ID = 0;
const ELLIPSIS = '\u2026';

let todolist;	// Todolist instance
let meta;

//----------------------------------------------------------------------

// TodoList class
let TodoList = GObject.registerClass(
class TodoList extends PanelMenu.Button {

	_init() {
		super._init(1.0, null, false);
		this.meta = meta;

		// Tasks file
		this.filePath = GLib.get_home_dir() + "/.todo.json";

		// Locale
		let locales = this.meta.path + "/locale";
		Gettext.bindtextdomain('todolist', locales);

		// Button ui
		this.mainBox = null;
		this.icon = new St.Icon({icon_name: 'emblem-documents-symbolic', style_class: 'system-status-icon'});
		this.buttonText = new St.Label({text: ELLIPSIS, y_align: Clutter.ActorAlign.CENTER});
		this.buttonText.set_style("text-align:center;");

		let topBox = new St.BoxLayout({ vertical: false, style_class: 'panel-status-menu-box' });
        topBox.add_child(this.icon);
		topBox.add_child(this.buttonText);
		this.add_child(topBox);

		this._buildUI();
		this._refresh();
	}

	_buildUI(){
		// Destroy previous box
		if (this.mainBox != null)
			this.mainBox.destroy();

		// Create main box
		this.mainBox = new St.BoxLayout();
		this.mainBox.set_vertical(true);

		// Separator
		this.mainBox.add_actor(new PopupMenu.PopupSeparatorMenuItem("TODO"));

		// Create todo box
		this.todoBox = new St.BoxLayout();
		this.todoBox.set_vertical(true);

		// Create todos scrollview
		var scrollView = new St.ScrollView({style_class: 'vfade',
			hscrollbar_policy: Gtk.PolicyType.NEVER,
			vscrollbar_policy: Gtk.PolicyType.AUTOMATIC});
		scrollView.add_actor(this.todoBox);
		this.mainBox.add_actor(scrollView);

		// Separator
		this.mainBox.add_actor(new PopupMenu.PopupSeparatorMenuItem("DONE"));

		// Create done box
		this.doneBox = new St.BoxLayout();
		this.doneBox.set_vertical(true);

		// Create dones scrollview
		var scrollView = new St.ScrollView({style_class: 'vfade',
			hscrollbar_policy: Gtk.PolicyType.NEVER,
			vscrollbar_policy: Gtk.PolicyType.AUTOMATIC});
		scrollView.add_actor(this.doneBox);
		this.mainBox.add_actor(scrollView);

		// Separator
		var separator = new PopupMenu.PopupSeparatorMenuItem();
		this.mainBox.add_actor(separator);

		// Text entry
		this.newTask = new St.Entry(
		{
			name: "newTaskEntry",
			hint_text: _("New task..."),
			track_hover: true,
			can_focus: true
		});

		let entryNewTask = this.newTask.clutter_text;
		entryNewTask.set_max_length(MAX_LENGTH);
		entryNewTask.connect('key-press-event', Lang.bind(this,function(o,e)
		{
			let symbol = e.get_key_symbol();
			if (symbol == KEY_RETURN || symbol == KEY_ENTER)
			{
				this.menu.close();
				this.buttonText.set_text(_("(...)"));
				addTask(o.get_text(),this.filePath);
				entryNewTask.set_text('');
			}
		}));

		// Bottom section
		var bottomSection = new PopupMenu.PopupMenuSection();
		bottomSection.actor.add_actor(this.newTask);
		bottomSection.actor.add_style_class_name("newTaskSection");
		this.mainBox.add_actor(bottomSection.actor);
		this.menu.box.add(this.mainBox);
	}

	_refresh(){

		// Check if tasks file exists
		checkFile(this.filePath);
		let taskList = readTasks(this.filePath)[LIST_ID];

		// Add all tasks to ui
		let tasks = 0;
		this.todoBox.destroy_all_children();
		for (const task of taskList.todo.filter(task => task != '' && task != '\n')) {
			this.todoBox.add(createItem(this, task, removeTodo));
			tasks += 1;
		}
		this.doneBox.destroy_all_children();
		for (const task of taskList.done.filter(task => task != '' && task != '\n')) {
			this.doneBox.add(createItem(this, task, removeDone, "doneTaskEntry"));
		}

		// Update status button
		this.buttonText.set_text("(" + tasks + ")");

		// Restore hint text
		this.newTask.hint_text = _("New task...");

	}

	_enable() {
		// Conect file 'changed' signal to _refresh
		let fileM = Gio.file_new_for_path(this.filePath);
		let mode = Shell.ActionMode ? Shell.ActionMode.ALL : Shell.KeyBindingMode.ALL;
		this.monitor = fileM.monitor(Gio.FileMonitorFlags.NONE, null);
		this.monitor.connect('changed', Lang.bind(this, this._refresh));

		// Key binding
		Main.wm.addKeybinding('open-todolist',
							  ExtensionSettings,
							  Meta.KeyBindingFlags.NONE,
							  mode,
							  Lang.bind(this, signalKeyOpen));
	}

	_disable() {
		// Stop monitoring file
		this.monitor.cancel();
	}
});

//----------------------------------------------------------------------
// Utils

// Called when 'open-todolist' is emitted (binded with Lang.bind)
function signalKeyOpen(){
	if (this.menu.isOpen)
		this.menu.close();
	else
	{
		this.menu.open();
		this.newTask.grab_key_focus();
	}
}

function createItem(parent, text, removeFunc, style)
{
	let item = new PopupMenu.PopupMenuItem(text);
	if (typeof style !== 'undefined') {
		item.label.set_style_class_name("doneTaskEntry");
	}
	let textClicked = text;
	item.connect('activate', Lang.bind(parent,function(){
		parent.menu.close();
		parent.buttonText.set_text(_("(...)"));
		removeFunc(textClicked,parent.filePath);
	}));
	return item;
}

// Read tasks from file
function readTasks(file){
	// Check if file exists
	if (!GLib.file_test(file, GLib.FileTest.EXISTS))
	{
		global.logError("Todo list : Error with file : " + file);
		return;
	}

    let content = Shell.get_file_contents_utf8_sync(file);
    let	obj = JSON.parse(content.toString());
	return obj;
}

// Write tasks to file
function writeTasks(tasks, file)
{
	// Check if file exists
	if (!GLib.file_test(file, GLib.FileTest.EXISTS))
	{
		global.logError("Todo list : Error with file : " + file);
		return;
	}

	let f = Gio.file_new_for_path(file);
	let out = f.replace(null, false, Gio.FileCreateFlags.NONE, null);
	Shell.write_string_to_stream (out, JSON.stringify(tasks));
	out.close(null);
}

// Check if file exists. Create it if not
function checkFile(file){
	if (!GLib.file_test(file, GLib.FileTest.EXISTS))
		GLib.file_set_contents(file,BASE_TASKS);
}

// Remove task from todo list
function removeTodo(text,file){

    // Append to done & remove from todo
	let	todos = readTasks(file);
	todos[LIST_ID].done.push(text);
	todos[LIST_ID].todo = todos[LIST_ID].todo.filter(task => task != text);
	log(JSON.stringify(todos))

	// Write new text to file
    writeTasks(todos, file);

	// Copy removed item to clipboard if enabled
	if(ExtensionSettings.get_boolean('clipboard'))
		Clipboard.set_text(CLIPBOARD_TYPE, text);
}

// Remove task from todo list
function removeDone(text,file){

	let	todos = readTasks(file);
	todos[LIST_ID].done = todos[LIST_ID].done.filter(task => task != text);
	log(JSON.stringify(todos))

	// Write new text to file
	writeTasks(todos, file);

	// Copy removed item to clipboard if enabled
	if(ExtensionSettings.get_boolean('clipboard'))
		Clipboard.set_text(CLIPBOARD_TYPE, text);
}


// Add task 'text' to file 'file'
function addTask(text,file)
{
    log(text + " " + file);
	// Don't add empty task
	if (text == '' || text == '\n')
		return;

	// Check if file exists
	if (!GLib.file_test(file, GLib.FileTest.EXISTS))
	{
		global.logError("Todo list : Error with file : " + file);
		return;
	}

	// Append to new items
	let content = Shell.get_file_contents_utf8_sync(file);
	let	todos = JSON.parse(content.toString());
	todos[LIST_ID].todo.push(text);

	writeTasks(todos, file);
}

//----------------------------------------------------------------------
// Shell entry points

// Init function
function init(metadata)
{
	meta = metadata;
}

function enable()
{
	todolist = new TodoList();
	todolist._enable();
	Main.panel.addToStatusArea('todolist', todolist, 1, 'right');
}

function disable()
{
	todolist._disable();
	todolist.destroy();
	todolist = null;
}

//----------------------------------------------------------------------
