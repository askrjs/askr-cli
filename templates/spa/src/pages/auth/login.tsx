import { state } from '@askrjs/askr';
import { navigate } from '@askrjs/askr/router';
import { LockKeyholeIcon } from '@askrjs/lucide';
import { Input } from '@askrjs/ui';
import {
  Button,
  Field,
  FieldHint,
  InputGroup,
  InputGroupText,
} from '@askrjs/themes/controls';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@askrjs/themes/surfaces';
import { Stack } from '@askrjs/themes/layouts';

export default function LoginPage() {
  const [email, setEmail] = state('ops@example.com');

  return (
    <Container size="sm" class="auth-page">
      <Card variant="raised">
        <CardHeader>
          <span class="card-icon">
            <LockKeyholeIcon size={18} aria-hidden="true" />
          </span>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            This starter keeps auth mocked, but the auth shell is isolated from
            the public landing layout and ready for a real session provider.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="4">
            <Field>
              <label for="email">Work email</label>
              <InputGroup>
                <InputGroupText>@</InputGroupText>
                <Input
                  id="email"
                  type="email"
                  value={email()}
                  onInput={(event: Event) =>
                    setEmail((event.currentTarget as HTMLInputElement).value)
                  }
                />
              </InputGroup>
              <FieldHint>Use any address to enter the demo console.</FieldHint>
            </Field>
            <Button onPress={() => navigate('/app')}>
              Continue to console
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
