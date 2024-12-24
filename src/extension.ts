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
        console.log(historyPointer.rootNode);
        if (controlFlag.isUndoRedo) return;

        for (const change of contentChanges) {
            const { range, text, rangeLength } = change;
            const oldText = getText(range);

            // pointer advances only forwards here - other operations are
            // controlled by commands
            historyPointer.addNodeAndAdvance({
                range,
                textAffected: text || oldText,
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

export function activate(context: ExtensionContext) {
    const observerMap = new Map<string, HistoryTreePointer>([]);
    const controlFlag = { isUndoRedo: false };

    workspace.onDidChangeTextDocument(
        handleTextDocumentChange(observerMap, controlFlag)
    );

    const undoDisposable = commands.registerCommand(
        "smart-undo-redo.undo",
        () => {
            // The code you place here will be executed every time your command is executed
            // Display a message box to the user
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
        () => {
            window.showQuickPick(["Redo option 1", "Redo option 2"]);
        }
    );

    context.subscriptions.push(undoDisposable, redoDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

