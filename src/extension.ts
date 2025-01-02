import {
    TextDocumentChangeEvent,
    window,
    ExtensionContext,
    workspace,
    commands,
    Range,
    Position,
} from "vscode";
import { ChangeData, HistoryTreePointer } from "./HistoryTree";

import { basename } from "path";
import { randomUUID } from "crypto";

function handleTextDocumentChange(
    observerMap: Map<string, HistoryTreePointer>,
    controlFlag: { isUndoRedo: boolean }
): (event: TextDocumentChangeEvent) => void {
    return function (event) {
        const {
            document: { fileName, getText },
            contentChanges,
        } = event;

        if (!observerMap.has(fileName))
            observerMap.set(fileName, new HistoryTreePointer());

        const historyPointer = observerMap.get(fileName)!;
        if (controlFlag.isUndoRedo) return;
        console.log(historyPointer.branches());
        for (const change of contentChanges) {
            const { range, text, rangeLength } = change;
            const oldText = getText(range);

            // pointer advances only forwards here - other operations are
            // controlled by commands
            historyPointer.addNodeAndAdvance({
                range,
                textAffected: text || oldText,
                nodeID: randomUUID(),
                editType: text
                    ? rangeLength === 0
                        ? "insert"
                        : "replace"
                    : "delete",
            });
        }
    };
}

function getActiveEditor() {
    const activeEditor = window.activeTextEditor;
    if (!activeEditor) return null;

    return activeEditor;
}

function getCurrentFilenameOrIgnore(type: "undo" | "redo") {
    const editor = getActiveEditor();
    if (editor) return basename(editor.document.uri.fsPath);

    commands.executeCommand(type);
    return null;
}

function calculateRange(start: Position, text: string): Range {
    const lines = text.split("\n");
    if (lines.length === 1)
        return new Range(start, start.translate(0, text.length));

    // calculate where the end cursor will be
    const verticalChange = lines.length - 1;
    const horizontalChange = lines[verticalChange].length;
    return new Range(
        start,
        new Position(start.line + verticalChange, horizontalChange)
    );
}

function reverseChange(changeData: ChangeData) {
    const editor = getActiveEditor();
    if (!editor) {
        window.showErrorMessage("Could not open editor");
        return;
    }
    return editor.edit((editBuilder) => {
        const { range, textAffected, editType } = changeData;
        const { start } = range;

        if (editType === "delete") editBuilder.insert(start, textAffected);

        if (editType === "insert") {
            const deleteRange = calculateRange(start, textAffected);
            editBuilder.delete(deleteRange);
        }

        if (editType === "replace")
            editBuilder.replace(changeData.range, changeData.textAffected);
    });
}

function executeChange(changeData: ChangeData) {
    const editor = getActiveEditor();
    if (!editor) {
        window.showErrorMessage("Could not open editor");
        return;
    }

    return editor.edit((editBuilder) => {
        const { range, textAffected, editType } = changeData;
        const { start } = range;
        if (editType === "delete") {
            const deleteRange = calculateRange(start, textAffected);
            editBuilder.delete(deleteRange);
        }

        if (editType === "insert") editBuilder.insert(start, textAffected);

        if (editType === "replace")
            editBuilder.replace(changeData.range, changeData.textAffected);
    });
}

export function activate(context: ExtensionContext) {
    const observerMap = new Map<string, HistoryTreePointer>([]);
    const controlFlag = { isUndoRedo: false };

    workspace.onDidChangeTextDocument(
        handleTextDocumentChange(observerMap, controlFlag)
    );

    // TODO: stop infinite redos
    const undoDisposable = commands.registerCommand(
        "smart-undo-redo.undo",
        () => {
            const filename = getCurrentFilenameOrIgnore("undo");
            if (!filename) return;

            const historyPointer = observerMap.get(filename);
            if (!historyPointer) return;

            const undoData = historyPointer.getUndoDataAndMove();
            if (!undoData) return;

            controlFlag.isUndoRedo = true;
            reverseChange(undoData)?.then((isSuccessful) => {
                controlFlag.isUndoRedo = false;
                if (!isSuccessful) {
                    window.showErrorMessage("Failed to undo action");
                    return;
                }
                console.log("reversed change");
            });
        }
    );

    const redoDisposable = commands.registerCommand(
        "smart-undo-redo.redo",
        async () => {
            const filename = getCurrentFilenameOrIgnore("undo");
            if (!filename) return;

            const historyPointer = observerMap.get(filename);
            console.log(historyPointer);
            if (!historyPointer) return;

            const changeData = await historyPointer.getRedoDataAndMove(
                async (branches) => {
                    const quickPickItems = branches.map((branch) => ({
                        label: branch.changes!.textAffected,
                        branch: branch,
                    }));

                    const selectedItem = await window.showQuickPick(
                        quickPickItems
                    );

                    if (!selectedItem?.branch) return;
                    return selectedItem.branch;
                }
            );

            if (!changeData) {
                console.log("End of branch");
                return;
            }

            controlFlag.isUndoRedo = true;
            executeChange(changeData!)?.then((isSuccessful) => {
                controlFlag.isUndoRedo = false;
                if (!isSuccessful) {
                    window.showErrorMessage("Failed to redo action");
                    return;
                }
                console.log("redid change");
            });
        }
    );

    context.subscriptions.push(undoDisposable, redoDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

