import { Range, TextDocumentContentChangeEvent } from "vscode";

export type ChangeData = {
    range: Range;
    textAffected: string;
    editType: "insert" | "delete" | "replace";
};

interface ChildSelectionHandler {
    (children: HistoryTreeNode[]): Promise<HistoryTreeNode>;
}

class HistoryTreeNode {
    private _parent?: HistoryTreeNode;
    private _change?: ChangeData;
    private _children: HistoryTreeNode[];

    constructor(changedContent?: ChangeData, parent?: HistoryTreeNode) {
        this._parent = parent;
        this._children = [];
        if (changedContent) this._change = changedContent;
    }

    public addNode(newChange: ChangeData) {
        const newNode = new HistoryTreeNode(newChange, this);
        this._children.push(newNode);
        return newNode;
    }

    public length() {
        return (
            1 +
            this._children.reduce(
                (acc, current): number => acc + current.length(),
                0
            )
        );
    }

    get changes() {
        return this._change;
    }

    get children() {
        return this._children;
    }

    get parent() {
        return this._parent;
    }
}

export class HistoryTreePointer {
    private _currentNode: HistoryTreeNode;
    private _rootPointer: HistoryTreeNode;

    constructor() {
        this._currentNode = new HistoryTreeNode();
        this._rootPointer = this._currentNode;
    }

    private async _traverseForward(selectChild: ChildSelectionHandler) {
        if (this._currentNode.children.length > 1) {
            const selectedChild = await selectChild(this._currentNode.children);
            this._currentNode = selectedChild;
            return;
        }
        this._currentNode = this._currentNode.children[0];
    }

    private _traverseBackward() {
        if (!this._currentNode.parent) return;

        this._currentNode = this._currentNode.parent;
    }

    // any action that is not a undo/redo command
    public addNodeAndAdvance(newChange: ChangeData) {
        const nextNode = this._currentNode.addNode(newChange);
        this._currentNode = nextNode;
    }

    // the current node represents the action just done
    public getUndoDataAndMove() {
        const changes = this._currentNode.changes;
        this._traverseBackward();
        return changes;
    }

    // the next node represents the action that was done after the current
    public async getRedoDataAndMove(selectChild: ChildSelectionHandler) {
        await this._traverseForward(selectChild);
        return this._currentNode.changes;
    }

    public length() {
        return this._rootPointer.length();
    }

    get currentNode() {
        return this._currentNode.changes;
    }

    get rootNode() {
        return this._rootPointer;
    }
}
