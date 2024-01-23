'use strict';
import * as vscode from 'vscode';
import { IJSONSchema } from './jsonSchema';
import { STATUS_CODES } from 'http';
import { ConfigurationTarget } from 'vscode';

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
	vscode.commands.registerCommand('setting.update', () => configuration.pickAndUpdate());
	vscode.commands.registerCommand('setting.reset', () => configuration.reset());
}

export function deactivate() {
}

export class Configuration {

	private settings: Map<string, IJSONSchema> = new Map<string, IJSONSchema>();
	private recentlyUpdated: string[];

	constructor(private context: vscode.ExtensionContext) {
		this.recentlyUpdated = JSON.parse(this.context.globalState.get('settings.picker.recentlyUpdated', '[]'));
	}

	update(defaultConfigurations: IJSONSchema) {
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

	async toggle() {
		const item = await vscode.window.showQuickPick(this.getBooleanSettings(), { matchOnDescription: true, placeHolder: "Select the setting to toggle" });
		if (item) {
			await this.toggleSetting(item.label);
		}
	}

	async pickAndUpdate() {
		const item = await vscode.window.showQuickPick(this.getSettings(), { matchOnDescription: true, placeHolder: "Select the setting to update" });
		if (item) {
			const setting = item.label;
			const schema = this.settings.get(item.label);
			if (schema) {
				if (schema.enum && schema.enum.length) {
					await this.updateEnumTypeSetting(setting, schema);
				} else {
					switch (schema.type) {
						case 'string':
							await this.updateStringTypeSetting(setting, schema);
							break;
						case 'number':
							await this.updateNumberTypeSetting(setting, schema);
							break;
						case 'boolean':
							await this.updateBooleanTypeSetting(setting, schema);
							break;
					}
				}
			}
		}
	}

	async reset() {
		const item = await vscode.window.showQuickPick(this.getSettings(), { matchOnDescription: true, placeHolder: "Select the setting to update" });
		if (item) {
			const configuration = vscode.workspace.getConfiguration(null);
			const setting = item.label;
			const inspect = configuration.inspect(setting);
			if (inspect) {
				await this.updateSetting(configuration, setting, inspect.defaultValue);
			}
		}
	}

	private async updateEnumTypeSetting(setting: string, schema: IJSONSchema) {
		const configuration = vscode.workspace.getConfiguration(null, null);
		const currentValue = configuration.get(setting);
		const inspect = configuration.inspect(setting);
		if (schema.enum && schema.enum.length) {
			const item = await vscode.window.showQuickPick(schema.enum.map((e, index) => (<vscode.QuickPickItem>{
				label: e,
				description: `${currentValue === e ? '(Current)' : ''}${inspect.defaultValue === e ? '(Default)' : ''}`
			})));
			if (item && currentValue !== item.label) {
				await this.updateSetting(configuration, setting, item.label);
			}
		}
	}

	private async updateBooleanTypeSetting(setting: string, schema: IJSONSchema) {
		const configuration = vscode.workspace.getConfiguration(null, null);
		const currentValue = configuration.get(setting);
		const inspect = configuration.inspect(setting);
		const item = await vscode.window.showQuickPick([
			{
				label: 'true',
				description: `${currentValue === true ? '(Current)' : ''}${inspect.defaultValue === true ? '(Default)' : ''}`
			},
			{
				label: 'false',
				description: `${currentValue === false ? '(Current)' : ''}${inspect.defaultValue === false ? '(Default)' : ''}`
			}
		]);
		if (item) {
			const value = item.label === 'true';
			if (value !== currentValue) {
				await this.updateSetting(configuration, setting, value);
			}

		}
	}

	private async updateStringTypeSetting(setting: string, schema: IJSONSchema) {
		const configuration = vscode.workspace.getConfiguration(null, null);
		const currentValue = configuration.get(setting);
		const inspect = configuration.inspect(setting);
		const value = await vscode.window.showInputBox({
			placeHolder: `Provide value for setting ${setting}`,
			prompt: `Current value: ${currentValue}`,
		});
		if (value && currentValue !== value) {
			await this.updateSetting(configuration, setting, value);
		}
	}

	private async updateNumberTypeSetting(setting: string, schema: IJSONSchema) {
		const configuration = vscode.workspace.getConfiguration(null, null);
		const currentValue = configuration.get(setting);
		const inspect = configuration.inspect(setting);
		const inputValue = await vscode.window.showInputBox({
			placeHolder: `Provide value for setting ${setting}`,
			prompt: `Current value: ${currentValue}`,
			validateInput: inputValue => {
				try {
					parseInt(inputValue)
				} catch (e) {
					return 'Provide a number value';
				}
				return null;
			}
		});
		if (inputValue) {
			const value = parseInt(inputValue);
			if (currentValue !== value) {
				await this.updateSetting(configuration, setting, value);
			}
		}
	}

	private getBooleanSettings(): vscode.QuickPickItem[] {
		const booleanSettings: vscode.QuickPickItem[] = [];
		const configuration = vscode.workspace.getConfiguration(null, null);

		for (const setting of this.recentlyUpdated) {
			const schema = this.settings.get(setting);
			if (schema && schema.type === 'boolean') {
				const value = configuration.get(setting);
				booleanSettings.push({
					label: setting,
					description: `${value}≫${!value}­­	☛${schema.description}`
				});
			}
		}

		this.settings.forEach((schema, setting) => {
			if (this.recentlyUpdated.indexOf(setting) === -1 && schema.type === 'boolean') {
				const value = configuration.get(setting);
				booleanSettings.push({
					label: setting,
					description: `${value}≫${!value}­­	☛${schema.description}`
				});
			}
		});
		return booleanSettings;
	}

	private getSettings(): vscode.QuickPickItem[] {
		const settings: vscode.QuickPickItem[] = [];

		for (const setting of this.recentlyUpdated) {
			const schema = this.settings.get(setting);
			if (schema) {
				settings.push({
					label: setting,
					description: `☛${schema.description}`
				});
			}
		}

		this.settings.forEach((schema, setting) => {
			if (this.recentlyUpdated.indexOf(setting) === -1) {
				settings.push({
					label: setting,
					description: `☛${schema.description}`
				});
			}
		});
		return settings;
	}

	private async toggleSetting(setting: string) {
		const configuration = vscode.workspace.getConfiguration(null, null);
		const value = configuration.get(setting)
		await this.updateSetting(configuration, setting, !value);
	}

	private async updateSetting(configuration: vscode.WorkspaceConfiguration, setting: string, value: any, target?: vscode.ConfigurationTarget) {
		const inspect = configuration.inspect(setting);
		if (inspect) {
			if (inspect.defaultValue === value) {
				if (inspect.workspaceValue !== undefined) {
					await this.updateSetting(configuration, setting, void 0, ConfigurationTarget.Workspace);
				}
				if (inspect.globalValue !== undefined) {
					await this.updateSetting(configuration, setting, void 0, ConfigurationTarget.Global);
				}
			} else {
				target = target !== void 0 ? target : inspect.workspaceValue !== void 0 ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
				await configuration.update(setting, value, target);
				const index = this.recentlyUpdated.indexOf(setting);
				if (index !== -1) {
					this.recentlyUpdated.splice(index, 1);
				}
				this.recentlyUpdated.splice(0, 0, setting);
				this.context.globalState.update('settings.picker.recentlyUpdated', JSON.stringify(this.recentlyUpdated));
			}
		}
	}

}