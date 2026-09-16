import React from 'react';

import { AddItemsModal } from '../../word-import/components/WordImportForm.jsx';

export function SessionWordEditDialog({ item, allItems, folders, onUpdateRecord, onClose }) {
  if (!item || !onUpdateRecord) return null;
  return (
    <AddItemsModal
      title="編輯單字"
      date={item.date}
      lockedDate
      editItem={item}
      allItems={allItems}
      folders={folders}
      onUpdateRecord={onUpdateRecord}
      onClose={onClose}
    />
  );
}
