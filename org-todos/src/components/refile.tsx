/*
 * Refile picker: choose a target file and project, and the task's subtree
 * moves there (stars adjusted, undoable).
 */

import { Action, ActionPanel, Icon, List, Toast, showToast, useNavigation } from "@vicinae/api";
import path from "node:path";
import { useEffect, useMemo, useState } from "react";
import { getConfig } from "../lib/config";
import { expandSources, loadProjects, refileTask, removeSubtreeByRaw, restoreTask, type FileProjects } from "../lib/files";
import type { Task } from "../lib/org";

interface Props {
  task: Task;
  onDone: () => void;
  registerUndo?: (label: string, revert: () => Promise<void>) => void;
}

export function RefilePicker({ task, onDone, registerUndo }: Props) {
  const { pop } = useNavigation();
  const config = useMemo(getConfig, []);
  const [targets, setTargets] = useState<FileProjects[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    expandSources(config.sources)
      .then((files) => loadProjects(files, config.keywords))
      .then(setTargets)
      .catch((e) => setError(String(e)));
  }, [config.sources, config.keywords]);

  async function move(targetFile: string, project?: { raw: string }) {
    try {
      const res = await refileTask(task, targetFile, project);
      registerUndo?.("Undo refile", async () => {
        await removeSubtreeByRaw(targetFile, res.newRaw);
        await restoreTask(task.file, res.index, res.removed);
      });
      await showToast({
        style: Toast.Style.Success,
        title: "Task refiled · ctrl+z to undo",
        message: `${task.title} → ${path.basename(targetFile)}`,
      });
      onDone();
      pop();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Could not refile task", message: String(e) });
    }
  }

  return (
    <List
      isLoading={!targets && !error}
      navigationTitle="Refile to…"
      searchBarPlaceholder="Choose a file and project…"
    >
      {error ? (
        <List.EmptyView title="Could not read files" description={error} icon={Icon.Exclamationmark} />
      ) : (
        targets?.map(({ file, projects }) => (
          <List.Section key={file} title={path.basename(file)} subtitle={file.replace(path.basename(file), "") || undefined}>
            <List.Item
              key={`${file}:top`}
              title="Top level (end of file)"
              icon={Icon.BlankDocument}
              actions={
                <ActionPanel>
                  <Action title="Refile here" icon={Icon.Folder} onAction={() => move(file)} />
                </ActionPanel>
              }
            />
            {projects.map((p) => (
              <List.Item
                key={`${file}:${p.line}`}
                title={p.title}
                icon={Icon.Folder}
                accessories={p.tags.map((t) => ({ tag: t }))}
                actions={
                  <ActionPanel>
                    <Action title={`Refile under “${p.title}”`} icon={Icon.Folder} onAction={() => move(file, p)} />
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>
        ))
      )}
    </List>
  );
}
