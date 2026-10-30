import type { NodeSetID } from '@sub-forge/core';
import { createModal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { Button } from './ui.tsx';
import { NodeSetPreview } from './NodeSetPreview.tsx';

export const NodeSetPreviewModal = createModal<{ nodeSet: NodeSetID; name: string }>(function NodeSetPreviewBody({ data, modal }) {
  return <ModalContent className="sm:max-w-2xl">
    <ModalHeader><ModalTitle>{data.name} · 节点预览</ModalTitle></ModalHeader>
    <NodeSetPreview nodeSet={data.nodeSet} />
    <ModalFooter><Button onClick={modal.cancel}>关闭</Button></ModalFooter>
  </ModalContent>;
});
