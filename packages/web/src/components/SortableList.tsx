import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type UniqueIdentifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, LockKeyhole } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cx } from './ui.tsx';

function SortableRow({ id, index, locked, blocked, render }: {
  id: UniqueIdentifier; index: number; locked: boolean; blocked: boolean; render: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id, disabled: { draggable: locked, droppable: locked || blocked },
  });
  const handle = locked
    ? <span role="img" aria-label={`第 ${index + 1} 项已锁定`} className="grid h-8 w-6 place-items-center text-muted"><LockKeyhole size={16} /></span>
    : <button ref={setActivatorNodeRef} type="button" aria-label={`拖动第 ${index + 1} 项`} className="grid h-8 w-6 touch-none cursor-grab place-items-center text-faint" {...attributes} {...listeners}><GripVertical size={16} /></button>;
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={cx(isDragging && 'relative z-10 shadow-md')}>{render(handle)}</li>;
}

export function SortableList<T>({ items, getKey, onReorder, renderItem, isLocked }: {
  items: T[]; getKey?: (item: T, index: number) => UniqueIdentifier; onReorder: (items: T[], move: { from: number; to: number }) => void;
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode; isLocked?: (item: T, index: number) => boolean;
}) {
  const [identity, setIdentity] = useState(() => ({ ids: items.map((_, i) => `s${i}`), seq: items.length }));
  const [active, setActive] = useState<UniqueIdentifier | null>(null);
  let ids = identity.ids;
  if (ids.length !== items.length) {
    let seq = identity.seq;
    ids = items.map((_, i) => identity.ids[i] ?? `s${seq++}`);
    setIdentity({ ids, seq });
  }
  const keys = items.map((item, i) => getKey ? getKey(item, i) : ids[i]!);
  const locked = items.map((item, i) => isLocked?.(item, i) ?? false);
  const canMove = (from: number, to: number) => from >= 0 && to >= 0 &&
    !locked.slice(Math.min(from, to), Math.max(from, to) + 1).some(Boolean);
  const activeIndex = active === null ? -1 : keys.indexOf(active);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <DndContext sensors={sensors} collisionDetection={(args) => closestCenter({
    ...args, droppableContainers: args.droppableContainers.filter((container) => canMove(keys.indexOf(args.active.id), keys.indexOf(container.id))),
  })} onDragStart={(event) => setActive(event.active.id)} onDragCancel={() => setActive(null)} onDragEnd={(event) => {
    setActive(null);
    const from = keys.indexOf(event.active.id);
    const to = event.over ? keys.indexOf(event.over.id) : -1;
    if (from === to || !canMove(from, to)) return;
    if (!getKey) setIdentity({ ...identity, ids: arrayMove(ids, from, to) });
    onReorder(arrayMove(items, from, to), { from, to });
  }}>
    <SortableContext items={keys} strategy={verticalListSortingStrategy}>
      <ol className="m-0 list-none p-0">{items.map((item, index) => <SortableRow key={keys[index]} id={keys[index]!} index={index}
        locked={locked[index]!} blocked={activeIndex >= 0 && !canMove(activeIndex, index)}
        render={(handle) => renderItem(item, index, handle)} />)}</ol>
    </SortableContext>
  </DndContext>;
}
