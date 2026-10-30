import type { ChainRule } from '@sub-forge/core';
import { createModal, ModalContent, ModalHeader, ModalTitle } from '../../modals/index.tsx';
import { ProfileContext } from './context.ts';
import { useModalProfile, type ProfileModalData } from './modalProfile.ts';
import { ChainRuleEditor } from './ChainRuleEditor.tsx';
export const ChainRuleModal = createModal<ProfileModalData & { chain: ChainRule; title: string; fixedLanding?: boolean; removable?: boolean }, ChainRule | null>(function ChainModal({ data, modal }) {
  const { ctx } = useModalProfile(data);
  return <ProfileContext.Provider value={ctx}><ModalContent className="flex h-[min(680px,calc(100dvh-32px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"><ModalHeader className="shrink-0 border-b border-line px-5 py-4"><ModalTitle>{data.title}</ModalTitle></ModalHeader><ChainRuleEditor initial={data.chain} fixedLanding={data.fixedLanding} onCancel={modal.cancel} onApply={modal.confirm} onRemove={data.removable ? () => modal.confirm(null) : undefined} /></ModalContent></ProfileContext.Provider>;
});
