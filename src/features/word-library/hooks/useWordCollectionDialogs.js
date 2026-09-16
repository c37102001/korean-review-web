import { useEffect, useState } from 'react';

export function useWordCollectionDialogs(sourceKey = '') {
  const [addOpen, setAddOpen] = useState(false);
  const [editingWord, setEditingWord] = useState(null);
  const [viewingWord, setViewingWord] = useState(null);

  useEffect(() => {
    setAddOpen(false);
    setEditingWord(null);
    setViewingWord(null);
  }, [sourceKey]);

  return {
    addOpen,
    openAdd: () => setAddOpen(true),
    closeAdd: () => setAddOpen(false),
    editingWord,
    openEditor: setEditingWord,
    closeEditor: () => setEditingWord(null),
    viewingWord,
    openViewer: setViewingWord,
    closeViewer: () => setViewingWord(null),
    editFromViewer: (word) => {
      setViewingWord(null);
      setEditingWord(word);
    },
  };
}
