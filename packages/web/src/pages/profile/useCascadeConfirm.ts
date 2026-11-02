import { memberLabel } from '../../components/pickers.tsx';
import { Frame } from '../../modals/Frame.tsx';
import { cascadeDescription, chainLabel, hasCascade, type ProfileCascade } from './chainModel.ts';
import { useProfile } from './context.ts';

/** 没有下游内容受影响时直接通过；否则先提示，确认后才由调用方应用。 */
export function useCascadeConfirm() {
  const { groupName, nodeSetName } = useProfile();
  return async (cascade: ProfileCascade<unknown>, message: { title: string; lead: string; confirmLabel: string }): Promise<boolean> => {
    if (!hasCascade(cascade)) return true;
    const description = cascadeDescription(cascade, message.lead, {
      chain: chain => chainLabel(chain, groupName),
      member: ({ groupId, member }) => `${groupName(groupId)}：${memberLabel(member, groupName, nodeSetName).text}`,
    });
    const result = await Frame.modal.confirm({ title: message.title, description, confirmLabel: message.confirmLabel, danger: true });
    return result.status === 'confirmed';
  };
}
