import type { ChainRule } from '@sub-forge/core';
import { createModal, ModalContent, ModalHeader, ModalTitle } from '../../modals/index.tsx';
import { ProfileContext } from './context.ts';
import { useModalProfile, type ProfileModalData } from './modalProfile.ts';
import { ChainRuleEditor } from './ChainRuleEditor.tsx';
export const ChainRuleModal = createModal<ProfileModalData & { chain: ChainRule; title: string; fixedLanding?: boolean; removable?: boolean }, ChainRule | null>(function ChainModal({ data, modal }) {
  const { ctx } = useModalProfile(data);
  return <ProfileContext.Provider value={ctx}><ModalContent className="flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-2xl"><ModalHeader><ModalTitle>{data.title}</ModalTitle></ModalHeader><ChainRuleEditor initial={data.chain} fixedLanding={data.fixedLanding} onCancel={modal.cancel} onApply={modal.confirm} onRemove={data.removable ? () => modal.confirm(null) : undefined} /></ModalContent></ProfileContext.Provider>;
});
