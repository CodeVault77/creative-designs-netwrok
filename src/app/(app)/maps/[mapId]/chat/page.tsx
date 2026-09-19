import { ScreenScaffold } from '@/components/shell/ScreenScaffold';
import { requireAuth } from '@/lib/auth/guard';
import { buildRoute } from '@/lib/routes';

export const metadata = { title: 'Map chat' };

export default async function Page({
  params,
}: {
  params: Promise<{ mapId: string }>;
}) {
  const { mapId } = await params;
  await requireAuth(buildRoute.mapChat(mapId));

  return (
    <ScreenScaffold
      screen="13"
      params={{ mapId }}
      links={[{ href: buildRoute.mapEditor(mapId), label: 'Back to editor (09)' }]}
    />
  );
}
