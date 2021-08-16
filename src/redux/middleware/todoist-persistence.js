import Todoist from '../../todoist-client/Todoist';
import { types, actions, isListBacklog, isBacklogListId } from '../modules/lists';
import List from '../../core/List';
import Item from "../../core/Item";
import moment from 'moment';

const todoistPersistenceMiddleware = store => next => action => {
    const state = store.getState();
    const token = state.user.user.token;
    const project_id = state.lists.defaultProjectId;
    const projects = state.lists.projects;
    const defaultProject = projects.find(p => p.id === project_id);

    switch (action.type) {
        case types.ADD_LIST_ITEM:
            function persistAddListItem() {
                const { list, item } = action.payload;
                const { content, temp_id } = item;

                const labelString = isListBacklog(list) ? '' : `@${list.title.replaceAll(' ', '_').toLowerCase()}`;
                const hasProjectSyntax = content.indexOf('#') >= 0;
                const projectString =
                    hasProjectSyntax || !defaultProject ? '' : `#${defaultProject.name.replaceAll(' ', '')}`;

                Todoist.quickAddItem(token, `${content} ${labelString} ${projectString}`, temp_id)
                    .then(({ id: itemId }) => store.dispatch(actions.updateId(Item, temp_id, `${itemId}`)))
                    .then(() => store.dispatch(actions.fetchLists()))
                    .catch(err => console.error('could not add item', err));
            }
            persistAddListItem();
            break;

        case types.COMPLETE_LIST:
            function persistCompleteList() {
                const { list } = action.payload;
                const itemIds = list.items.map(item => item.id);
                Todoist.completeListItems(token, itemIds);
            }
            persistCompleteList();
            break;

        case types.DELETE_LIST:
            function deleteList() {
                const { list } = action.payload;
                // Note: remove todoist label (deleting label does not appear to remove from items)
                list.items.forEach(item => Todoist.updateItem(token, { id: item.id, labels: [] })); // TODO
                if (!isListBacklog(list)) {
                    Todoist.deleteLabel(token, list.id);
                }
            }
            deleteList();
            break;

        case types.COMPLETE_LIST_ITEM:
            function persistCompleteListItem() {
                const { item } = action.payload;
                Todoist.completeListItem(token, item.id);
            }
            persistCompleteListItem();
            break;

        case types.UPDATE_LIST_ITEM:
            function persistContentChange() {
                const { item, fields } = action.payload;
                const update = { id: item.id };
                const { text: content, due } = fields;
                if (content) {
                    update.content = content;
                }
                if (due && due.date) {
                    update.due = due;
                } else if (due && due.date === null) {
                    update.due = null;
                }
                Todoist.updateItem(token, update);
            }
            persistContentChange();
            break;

        case types.ADD_NEW_LIST:
            function persistAddLabel() {
                const { name, temp_id } = action.payload;

                // TODO: un-duplicated in lists module
                // prevent multiple lists from having the same name
                let title = name;
                let titleAlreadyUsed = state.lists.lists.map(list => list.title).contains(title);
                while (titleAlreadyUsed) {
                    title = title + ' 2';
                    titleAlreadyUsed = state.lists.lists.map(list => list.title).contains(title);
                }

                const newLabel = { name: title, item_order: state.lists.lists.size + 1 };
                Todoist.addLabel(token, newLabel, temp_id).then(response => {
                    store.dispatch({
                        type: types.UPDATE_ID,
                        payload: {
                            type: List,
                            old_id: temp_id,
                            new_id: response.temp_id_mapping[temp_id],
                        },
                    });
                });
            }
            persistAddLabel();
            break;

        case types.RENAME_LIST:
            function persistLabelRename() {
                const { list, newListName } = action.payload;

                // prevent multiple lists from having the same name
                let title = newListName;
                let titleAlreadyUsed = state.lists.lists.map(list => list.title).contains(title);
                while (titleAlreadyUsed) {
                    title = title + ' 2';
                    titleAlreadyUsed = state.lists.lists.map(list => list.title).contains(title);
                }

                if (!isListBacklog(list)) {
                    Todoist.updateLabelName(token, list.id, title);
                }
            }
            persistLabelRename();
            break;

        case types.MOVE_ITEM: {
            console.log("Move called");
            const { itemId, fromListId, toListId } = action.payload;

            if (fromListId === toListId) {
                break;
            }

            const fromList = state.lists.lists.push(state.lists.backlog).find(l => l.id === fromListId);
            const toList = state.lists.lists.push(state.lists.backlog).find(l => l.id === toListId);
            const item = fromList.get('items').find(i => i.id === itemId);

            // get all labels for item
            const labels = state.lists.lists
                .filter(l => l.items.map(i => i.id).includes(itemId))
                .map(l => l.id)
                .concat(isListBacklog(toList) ? [] : [toListId])
                .filter(listId => !isBacklogListId(listId) && listId !== fromListId)
                .toSet().toArray();

            console.log(labels);

            // TODO(pbozzay): Check to see if this is a date ID. Find the new date that this item should have.
            //const updatedItem = { id: item.id, labels };

            // TODO: Do this in MST or users timezone from browser.
            const dueDate = moment(toListId);
            const daysFromNow = dueDate.diff(new Date(), 'days')
            const updatedItem = { id: item.id, due: {
                 date: dueDate.format("YYYY-MM-DD"),
                 string: "in " + daysFromNow + " days",
                 recurring: false,
                }};
            console.log("====");
            console.log(updatedItem);

            Todoist.updateItem(token, updatedItem);
            break;
        }
        case types.UPDATE_LIST_INDEX: {
            const { listId, newIndex } = action.payload;
            const { lists } = state.lists;

            const list = lists.find(l => l.id === listId);
            const labelOrderMap = lists
                .filter(el => el.id !== listId)
                .insert(newIndex, list)
                .map(l => l.id)
                .reduce((acc, lid, idx) => Object.assign(acc, { [lid]: idx }), {});

            Todoist.updateLabelOrder(token, labelOrderMap);
            break;
        }
        default:
            // Nothing.
    }

    // Fire next action.
    next(action);
};

export default todoistPersistenceMiddleware;
