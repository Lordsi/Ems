import { Compass } from 'lucide-react';
import { Card, EmptyState, LinkButton } from '../components/ui';

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        icon={<Compass className="size-5" />}
        title="Page not found"
        description="The page you're looking for doesn't exist, or you don't have access to it."
        action={<LinkButton to="/">Back to dashboard</LinkButton>}
      />
    </Card>
  );
}
