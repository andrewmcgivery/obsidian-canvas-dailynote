import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	getIcon,
} from "obsidian";

const AUTO_UPDATE_DAILY_NOTE = "autoUpdateDailyNote";
const DAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

interface CanvasView extends ItemView {
	canvas: Canvas;
}

interface Canvas {
	cardMenuEl: HTMLElement;
	nodes: CanvasNode[];
	removeNode(node: CanvasNode): void;
	requestSave(): void;
	createFileNode(options: any): CanvasNode;
	deselectAll(): void;
	addNode(node: CanvasNode): void;
}

interface CanvasNode {
	unknownData: UnknownData;
	nodeEl: HTMLElement;
	file: TFile;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface UnknownData {
	nodeType: string;
}

interface CanvasDailyNotePluginSettings {
	createIfNotExists: boolean;
	skipMonday: boolean;
	skipTuesday: boolean;
	skipWednesday: boolean;
	skipThursday: boolean;
	skipFriday: boolean;
	skipSaturday: boolean;
	skipSunday: boolean;
}

const DEFAULT_SETTINGS: CanvasDailyNotePluginSettings = {
	createIfNotExists: false,
	skipMonday: false,
	skipTuesday: false,
	skipWednesday: false,
	skipThursday: false,
	skipFriday: false,
	skipSaturday: false,
	skipSunday: false,
};

/**
 * This allows a "live-reload" of Obsidian when developing the plugin.
 * Any changes to the code will force reload Obsidian.
 */
if (process.env.NODE_ENV === "development") {
	new EventSource("http://127.0.0.1:8000/esbuild").addEventListener(
		"change",
		() => location.reload()
	);
}

export default class CanvasDailyNotePlugin extends Plugin {
	settings: CanvasDailyNotePluginSettings;
	dailyNotePlugin: any;

	async onload() {
		await this.loadSettings();

		// Get an instance of the daily notes plugin so we can interact with it
		this.dailyNotePlugin = (this.app as any).internalPlugins.getPluginById(
			"daily-notes"
		)?.instance;

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CanvasDailyNotePluginSettingTab(this.app, this));

		// Hook into the file open event
		this.app.workspace.on("file-open", this.handleFileOpen.bind(this));
	}

	/**
	 * When a file is opened, we check if the file is a canvas. If it is, we'll hook into it.
	 */
	async handleFileOpen() {
		const canvasView = this.app.workspace.getActiveViewOfType(
			ItemView
		) as CanvasView;

		// Only need to run this code if we're looking at a canvas
		if (canvasView?.getViewType() !== "canvas") {
			return;
		}

		const canvas = canvasView?.canvas;
		this.createButton(canvas);
		this.processCanvasNodes(canvas);
	}

	/**
	 * Add a new button to the card UI at the bottom. Clicking the button will attempt to add a daily note to the canvas.
	 * @param canvas
	 */
	createButton(canvas: Canvas) {
		const cardMenuEl = canvas.cardMenuEl;

		// Only create the canvas button if it doesn't already exist
		if (!cardMenuEl.querySelector(".canvas-button-adddailynote")) {
			const button = cardMenuEl.createEl("div", {
				attr: {
					class: "canvas-card-menu-button canvas-button-adddailynote",
				},
			});

			const icon = getIcon("calendar") as Node;
			button.appendChild(icon).addEventListener("click", async () => {
				let dailyFile = this.getExistingDailyFile();
				if (!dailyFile && !this.settings.createIfNotExists) {
					new Notice(
						"Daily note currently does not exist and plugin settings are set to not create it."
					);
					return;
				}

				// Don't create note on days that are configured to be skipped
				const dayOfTheWeek = DAYS[new Date().getDay()];
				// @ts-ignore
				if (!dailyFile && this.settings[`skip${dayOfTheWeek}`]) {
					new Notice(
						`Daily note currently does not exist and plugin settings are set to not create it on ${dayOfTheWeek}.`
					);
					return;
				}

				// This will either get the existing note or create a new one. Either way, returns the file.
				dailyFile =
					(await this.dailyNotePlugin.getDailyNote()) as TFile;

				this.addDailyNote(canvas, dailyFile);
			});
		}
	}

	/**
	 * This services two purposes
	 * 1. Adding a styling class to the daily note nodes
	 * 2. Updating any out of date daily note nodes with today's note
	 * @param canvas
	 */
	processCanvasNodes(canvas: Canvas) {
		let dailyFile = this.getExistingDailyFile();

		canvas.nodes.forEach(async (node) => {
			if (node.unknownData.nodeType !== AUTO_UPDATE_DAILY_NOTE) {
				return;
			}
			// Add class to each found auto daily note
			node.nodeEl.addClass("canvas-node-dailynote");

			// If the note is out of date, replace it with a new daily note node in the same x/y with the same width/height
			if (node?.file?.path !== dailyFile?.path || !node.file) {
				if (!dailyFile && !this.settings.createIfNotExists) {
					return;
				}

				const dayOfTheWeek = DAYS[new Date().getDay()];
				// @ts-ignore
				if (!dailyFile && this.settings[`skip${dayOfTheWeek}`]) {
					return;
				}

				canvas.removeNode(node);
				canvas.requestSave();

				dailyFile =
					(await this.dailyNotePlugin.getDailyNote()) as TFile;

				this.addDailyNote(canvas, dailyFile, {
					x: node.x,
					y: node.y,
					width: node.width,
					height: node.height,
				});
			}
		});
	}

	/**
	 * Gets the existing daily note based on the daily notes plugin settings or returns null if it does not exist.
	 */
	getExistingDailyFile(): TFile | null {
		const dailyFolder = this.dailyNotePlugin.options.folder;
		const expectedNotePath = `${dailyFolder}/${new Date().getFullYear()}-${String(
			new Date().getMonth() + 1
		).padStart(2, "0")}-${String(new Date().getDate()).padStart(
			2,
			"0"
		)}.md`;
		let dailyFile = this.app.vault
			.getAllLoadedFiles()
			.find((file) => file.path === expectedNotePath) as TFile;

		return dailyFile;
	}

	/**
	 * Adds the Daily Note node to the canvas. Stores a special "nodeType" property so we can identify it later.
	 * @param canvas
	 * @param dailyFile
	 * @param options
	 */
	addDailyNote(canvas: Canvas, dailyFile: TFile, options: any = {}) {
		const dailyFileNode = canvas.createFileNode({
			pos: {
				x: options.x || 0,
				y: options.y || 0,
				height: options.height || 500,
				width: options.width || 500,
			},
			size: {
				x: options.x || 0,
				y: options.y || 0,
				height: options.height || 500,
				width: options.width || 500,
			},
			file: dailyFile,
			path: this.dailyNotePlugin.options.folder,
			focus: false,
			save: true,
		});
		dailyFileNode.unknownData.nodeType = AUTO_UPDATE_DAILY_NOTE;
		canvas.deselectAll();
		canvas.addNode(dailyFileNode);
		canvas.requestSave();
	}

	onunload() {}

	/**
	 * Load data from disk, stored in data.json in plugin folder
	 */
	async loadSettings() {
		const data = (await this.loadData()) || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	/**
	 * Save data to disk, stored in data.json in plugin folder
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class CanvasDailyNotePluginSettingTab extends PluginSettingTab {
	plugin: CanvasDailyNotePlugin;

	constructor(app: App, plugin: CanvasDailyNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Automatically create daily note")
			.setDesc(
				`Should the plugin attempt to create the daily note if it does not exist?`
			)
			.addToggle((component) => {
				component.setValue(this.plugin.settings.createIfNotExists);
				component.onChange((value) => {
					this.plugin.settings.createIfNotExists = value;
					this.plugin.saveSettings();
				});
			});

		containerEl.createEl("hr");

		containerEl.createEl("h1", { text: "Skip days" });
		containerEl.createEl("p", {
			attr: {
				style: "display: block; margin-bottom: 10px",
			},
			text: "If there are certain days of the week you wish to skip creating a new note for, you can configure that here. The plugin will not attempt to automatically create new notes on those days.",
		});

		DAYS.forEach((day) => {
			new Setting(containerEl)
				.setName(day)
				.setDesc(`Skip automatically creating notes on ${day}?`)
				.addToggle((component) => {
					// @ts-ignore
					component.setValue(this.plugin.settings[`skip${day}`]);
					component.onChange((value) => {
						// @ts-ignore
						this.plugin.settings[`skip${day}`] = value;
						this.plugin.saveSettings();
					});
				});
		});
	}
}
