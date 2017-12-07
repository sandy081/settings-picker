'use strict';
import * as vscode from 'vscode';
import { IJSONSchema } from './jsonSchema';
import { STATUS_CODES } from 'http';

export async function activate(context: vscode.ExtensionContext) {

	const configuration = new Configuration(context);
	const defaultSettingsSchemaResource = vscode.Uri.parse('vscode://schemas/settings/default');
	const textDocument = await vscode.workspace.openTextDocument(defaultSettingsSchemaResource);
	configuration.update(JSON.parse(textDocument.getText()));

	vscode.workspace.onDidChangeTextDocument(e => {
		if (e.document.uri.toString() === defaultSettingsSchemaResource.toString()) {
			configuration.update(JSON.parse(e.document.getText()));
		}
	});

	vscode.commands.registerCommand('setting.toggle', () => configuration.toggle());
}

export function deactivate() {
}

export class Configuration {

	private settings: Map<string, IJSONSchema> = new Map<string, IJSONSchema>();
	private recentlyUpdated: string[];

	constructor(private context: vscode.ExtensionContext) {
		this.recentlyUpdated = JSON.parse(this.context.globalState.get('settings.picker.recentlyUpdated', '[]'));
	}

	public update(defaultConfigurations: IJSONSchema) {
		const register = (configuration: IJSONSchema) => {
			let properties = configuration.properties;
			if (properties) {
				for (let key in properties) {
					const property = properties[key];
					switch (property.type) {
						case 'string':
						case 'number':
						case 'boolean':
							this.settings.set(key, property);
							break;
					}
				}
			}
			let subNodes = configuration.allOf;
			if (subNodes) {
				subNodes.forEach(register);
			}
		}
		register(defaultConfigurations);
	}

	toggle(): void {
		vscode.window.showQuickPick(this.getBooleanSettings(), { matchOnDescription: true, placeHolder: "Select the setting to toggle" })
			.then(item => this.toggleSetting(item.label));
	}

	private getBooleanSettings(): vscode.QuickPickItem[] {
		const booleanSettings: vscode.QuickPickItem[] = [];

		for (const setting of this.recentlyUpdated) {
			const schema = this.settings.get(setting);
			if (schema && schema.type === 'boolean') {
				booleanSettings.push({
					label: setting,
					description: schema.description
				});
			}
		}

		this.settings.forEach((schema, setting) => {
			if (this.recentlyUpdated.indexOf(setting) === -1 && schema.type === 'boolean') {
				booleanSettings.push({
					label: setting,
					description: schema.description
				});
			}
		});
		return booleanSettings;
	}

	private async toggleSetting(setting: string) {
		const configuration = vscode.workspace.getConfiguration();
		const inspect = configuration.inspect(setting);
		const value = configuration.get(setting)
		if (inspect) {
			await this.updateSetting(configuration, setting, !value, inspect.workspaceValue !== void 0 ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
		}
	}

	private async updateSetting(configuration: vscode.WorkspaceConfiguration, setting: string, value: any, target: vscode.ConfigurationTarget) {
		await configuration.update(setting, value, target);
		const index = this.recentlyUpdated.indexOf(setting);
		if (index !== -1) {
			this.recentlyUpdated.splice(index, 1);
		}
		this.recentlyUpdated.splice(0, 0, setting);
		this.context.globalState.update('settings.picker.recentlyUpdated', JSON.stringify(this.recentlyUpdated));
	}

}