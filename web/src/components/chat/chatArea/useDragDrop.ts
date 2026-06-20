/**
 * chatArea/useDragDrop.ts — file drag-and-drop onto the chat area.
 * Returns the overlay flag, the dropped files (consumed by the Composer) and
 * the drag event handlers to spread onto the container.
 */
import { useState, useRef, useCallback } from 'react';

export function useDragDrop() {
  const [dragOver,     setDragOver]     = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }, []);
  const handleDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }, []);
  const handleDrop      = useCallback((e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current = 0; setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) setDroppedFiles(files);
  }, []);

  return { dragOver, droppedFiles, setDroppedFiles, handleDragEnter, handleDragLeave, handleDragOver, handleDrop };
}
