import { randomUUID } from "crypto";
import { QuickPickItem, Range, TextDocumentContentChangeEvent } from "vscode";

export type ChangeData = {
    range: Range;
    textAffected: string;
    editType: "insert" | "delete" | "replace";
    nodeID: string;
};

interface ChildSelectionHandler {
    (children: HistoryTreeNode[]): Promise<HistoryTreeNode | undefined>;
}

class HistoryTreeNode {
    private _parent?: HistoryTreeNode;
    private _change?: ChangeData;
    private _children: HistoryTreeNode[];
    private _nodeID: string;

    constructor(changedContent?: ChangeData, parent?: HistoryTreeNode) {
        this._parent = parent;
        this._children = [];
        this._nodeID = randomUUID();
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

    public getBranches(currentPath: ChangeData[]): ChangeData[][] {
        // if root node, then just return
        // if (!this._change) return [];

        // if leaf node, then just return the current path
        if (this._children.length === 0)
            return [[...currentPath, this._change!]];

        // branching node -
        const paths: ChangeData[][] = [];
        for (const branch of this._children) {
            // this will return a list of lists
            const childBranches = branch.getBranches([
                ...currentPath,
                this._change!,
            ]);
            paths.push(...childBranches);
        }

        return paths;
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

    get nodeID() {
        return this._nodeID;
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
        if (this._currentNode.children.length === 0) return;
        if (this._currentNode.children.length > 1) {
            const selectedChild = await selectChild(this._currentNode.children);
            if (selectedChild) this._currentNode = selectedChild;
            return;
        }
        this._currentNode = this._currentNode.children[0];
    }

    private _traverseBackward() {
        if (!this._currentNode.parent?.changes) return;

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

    public branches() {
        return this._rootPointer.getBranches([]);
    }

    get currentNode() {
        return this._currentNode.changes;
    }

    get rootNode() {
        return this._rootPointer;
    }
}
