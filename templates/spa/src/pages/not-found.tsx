import { Link } from '@askrjs/askr/router';
import { Button } from '@askrjs/themes/components';
import { Container, Section } from '@askrjs/themes/components';
import { EmptyState } from '@askrjs/themes/components';

export default function NotFoundPage() {
  return (
    <Section paddingY="2xl">
      <Container size="sm">
        <EmptyState
          title="Page not found"
          description="The route tree is explicit, so unknown paths fall back here."
          actions={
            <Button asChild>
              <Link href="/">Return home</Link>
            </Button>
          }
        />
      </Container>
    </Section>
  );
}
