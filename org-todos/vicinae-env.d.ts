/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Todos File - Main todos file (~ is expanded). New tasks are written here. */
	"todosFile": string;

	/** Additional Files - Comma-separated extra .org files or directories to read tasks from */
	"extraFiles": string;

	/** TODO Keywords - Same format as #+TODO: — active states, a bar, then done states */
	"todoKeywords": string;

	/** Archive File - Where 'Archive Task' moves subtrees (~ is expanded). Created if missing. */
	"archiveFile": string;

	/** Editor Command - Shell command used by 'Open in Editor'. {file} and {line} are substituted. */
	"editorCommand": string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Todos */
	export type ListTasks = ExtensionPreferences & {
		
	}

	/** Command: Agenda */
	export type Agenda = ExtensionPreferences & {
		
	}

	/** Command: New Todo */
	export type AddTask = ExtensionPreferences & {
		
	}

	/** Command: Quick Add Todo */
	export type QuickAdd = ExtensionPreferences & {
		
	}

	/** Command: Capture from Clipboard */
	export type Capture = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Todos */
	export type ListTasks = {
		
	}

	/** Command: Agenda */
	export type Agenda = {
		
	}

	/** Command: New Todo */
	export type AddTask = {
		
	}

	/** Command: Quick Add Todo */
	export type QuickAdd = {
		/** buy resistors tomorrow p1 #hardware */
		"text"?: string
	}

	/** Command: Capture from Clipboard */
	export type Capture = {
		
	}
}