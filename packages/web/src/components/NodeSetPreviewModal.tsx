import type { NodeSetID } from '@sub-forge/core';
import { createModal, ModalContent, ModalHeader, ModalTitle, ModalFooter, useModalDraft } from '../modals/index.tsx';
import { Button, Field, Input } from './ui.tsx';
import { NodeSetPreview } from './NodeSetPreview.tsx';

export const NodeSetPreviewModal = createModal<{ nodeSet: NodeSetID; name: string }>(function NodeSetPreviewBody({ data, modal }) {
  const [filter, setFilter] = useModalDraft('');
  return <ModalContent className="sm:max-w-2xl">
    <ModalHeader><ModalTitle>{data.name} · 节点预览</ModalTitle></ModalHeader>
    <Field label="节点筛选（正则）">{id => <Input id={id} placeholder="全部" value={filter} onChange={event => setFilter(event.target.value)} />}</Field>
    <NodeSetPreview nodeSet={data.nodeSet} filter={filter} />
    <ModalFooter><Button onClick={modal.cancel}>关闭</Button></ModalFooter>
  </ModalContent>;
});
