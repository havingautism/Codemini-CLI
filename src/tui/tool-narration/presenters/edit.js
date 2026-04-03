import { createChangePresenter } from './change.js';

export const editPresenter = createChangePresenter({ verb: 'update', verbZh: '修改' });
