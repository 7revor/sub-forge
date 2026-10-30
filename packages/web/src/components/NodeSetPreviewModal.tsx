import type { NodeSetID } from '@sub-forge/core';
import { createModal, ModalContent, ModalHeader, ModalTitle } from '../modals/index.tsx';
import { NodeSetPreview } from './NodeSetPreview.tsx';

export const NodeSetPreviewModal = createModal<{ nodeSet: NodeSetID; name: string }>(function NodeSetPreviewBody({ data }) {
  return <ModalContent className="pb-12 sm:max-w-md">
    <ModalHeader><ModalTitle>{data.name} · 节点预览</ModalTitle></ModalHeader>
    <NodeSetPreview nodeSet={data.nodeSet} />
  </ModalContent>;
});
