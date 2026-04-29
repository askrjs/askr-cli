import { state } from '@askrjs/askr';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@askrjs/ui';
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from '@askrjs/ui/composites/accordion';
import { Input } from '@askrjs/ui/primitives/input';
import { Toggle } from '@askrjs/ui/primitives/toggle';
import {
  BookOpenIcon,
  LayoutGridIcon,
  ListIcon,
  SparklesIcon,
  ToggleLeftIcon,
} from '@askrjs/lucide';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Grid,
  Inline,
  Section,
} from '@askrjs/themes/components';
import Counter from '../components/counter';

export default function Components() {
  const name = state('');
  const bold = state(false);

  return (
    <>
      <Section>
        <section class="page-header components-hero">
          <div class="page-header-copy">
            <p class="marketing-eyebrow">Components</p>
            <h1>A few controls, a little state, nothing more.</h1>
            <p class="marketing-lead text-muted">
              This page keeps the demo intentionally small: tabs, accordion,
              and one shared state value driving two controls.
            </p>
          </div>
        </section>
      </Section>

      <Counter />

      <Section>
        <Grid minItemWidth="18rem" gap="4">
          <Card class="showcase-card" variant="raised">
            <CardHeader>
              <CardTitle>
                <Inline as="span" align="center" gap="2">
                  <LayoutGridIcon size={16} />
                  <span>Tabs</span>
                </Inline>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="reactive">
                <TabsList>
                  <TabsTrigger value="reactive">
                    <Inline as="span" align="center" gap="1">
                      <SparklesIcon size={14} />
                      <span>Reactive</span>
                    </Inline>
                  </TabsTrigger>
                  <TabsTrigger value="composition">
                    <Inline as="span" align="center" gap="1">
                      <BookOpenIcon size={14} />
                      <span>Composition</span>
                    </Inline>
                  </TabsTrigger>
                  <TabsTrigger value="theme">
                    <Inline as="span" align="center" gap="1">
                      <LayoutGridIcon size={14} />
                      <span>Theme</span>
                    </Inline>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="reactive">
                  <p>
                    <code>state()</code> updates only the parts of the page
                    that read the current value.
                  </p>
                </TabsContent>
                <TabsContent value="composition">
                  <p>
                    askr-ui provides the structure while the app chooses how
                    much UI to assemble.
                  </p>
                </TabsContent>
                <TabsContent value="theme">
                  <p>
                    askr-themes styles the shared slots so the components look
                    like part of the same app shell.
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card class="showcase-card" variant="raised">
            <CardHeader>
              <CardTitle>
                <Inline as="span" align="center" gap="2">
                  <ListIcon size={16} />
                  <span>Accordion</span>
                </Inline>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible>
                <AccordionItem value="size">
                  <AccordionHeader>
                    <AccordionTrigger>Why keep this page small?</AccordionTrigger>
                  </AccordionHeader>
                  <AccordionContent>
                    <p>
                      The goal is to show a believable app surface, not every
                      control in the design system.
                    </p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="reactivity">
                  <AccordionHeader>
                    <AccordionTrigger>Where is the reactivity?</AccordionTrigger>
                  </AccordionHeader>
                  <AccordionContent>
                    <p>
                      The counter and the input row both update live from local
                      state.
                    </p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="styling">
                  <AccordionHeader>
                    <AccordionTrigger>What provides the styling?</AccordionTrigger>
                  </AccordionHeader>
                  <AccordionContent>
                    <p>
                      The components stay headless while askr-themes supplies
                      the skin and layout primitives.
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </Grid>
      </Section>

      <Section>
        <Card class="showcase-card" variant="raised">
          <CardHeader>
            <CardTitle>
              <Inline as="span" align="center" gap="2">
                <ToggleLeftIcon size={16} />
                <span>Shared state</span>
              </Inline>
            </CardTitle>
            <CardDescription>
              One state value drives both the toggle and the preview text.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="example-controls">
              <Toggle pressed={bold()} onPress={() => bold.set((value) => !value)}>
                Bold
              </Toggle>
              <Input
                placeholder="Name"
                onInput={(event: Event) =>
                  name.set((event.target as HTMLInputElement).value)
                }
              />
            </div>
            <p style={`font-weight: ${bold() ? '700' : '400'}`}>
              {name() ? `Hi, ${name()}!` : 'Type a name to update the preview.'}
            </p>
          </CardContent>
        </Card>
      </Section>
    </>
  );
}
