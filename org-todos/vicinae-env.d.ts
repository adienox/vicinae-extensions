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

	/** Clocking - Run org-clock-in/org-clock-out in a running Emacs server (via emacsclient) so Emacs' clock stays authoritative. Falls back to editing the file directly when no server is reachable. */
	"clockViaEmacs": boolean;

	/** Emacs Client - Command used to reach Emacs. Extra arguments are allowed, e.g. 'emacsclient -s /run/user/1000/emacs/server'. */
	"emacsclientCommand": string;

	/** Editor Command - Shell command used by 'Open in Editor'. {file} and {line} are substituted. */
	"editorCommand": string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Todos */
	export type ListTasks = ExtensionPreferences & {
		
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