import { state } from '@askrjs/askr';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@askrjs/askr-ui';
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from '@askrjs/askr-ui/composites/accordion';
import { Input } from '@askrjs/askr-ui/primitives/input';
import { Toggle } from '@askrjs/askr-ui/primitives/toggle';
import {
  BookOpenIcon,
  LayoutGridIcon,
  ListIcon,
  SparklesIcon,
  ToggleLeftIcon,
} from '@askrjs/askr-lucide';
import Counter from '../components/counter';
import IconLabel from '../components/icon-label';

export default function Components() {
  const name = state('');
  const bold = state(false);

  return (
    <>
      <section class="page-header components-hero">
        <div class="page-header-copy">
          <p class="marketing-eyebrow">Components</p>
          <h1>A few controls, a little state, nothing more.</h1>
          <p class="marketing-lead text-muted">
            This page keeps the demo intentionally small: tabs, accordion, and
            one shared state value driving two controls.
          </p>
        </div>
      </section>

      <Counter />

      <div class="marketing-card-grid">
        <div class="showcase-section panel">
          <h3>
            <IconLabel icon={<LayoutGridIcon size={16} />}>Tabs</IconLabel>
          </h3>
          <Tabs defaultValue="reactive">
            <TabsList>
              <TabsTrigger value="reactive">
                <IconLabel compact icon={<SparklesIcon size={14} />}>
                  Reactive
                </IconLabel>
              </TabsTrigger>
              <TabsTrigger value="composition">
                <IconLabel compact icon={<BookOpenIcon size={14} />}>
                  Composition
                </IconLabel>
              </TabsTrigger>
              <TabsTrigger value="theme">
                <IconLabel compact icon={<LayoutGridIcon size={14} />}>
                  Theme
                </IconLabel>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="reactive">
              <p>
                <code>state()</code> updates only the parts of the page that
                read the current value.
              </p>
            </TabsContent>
            <TabsContent value="composition">
              <p>
                askr-ui provides the structure while the app chooses how much UI
                to assemble.
              </p>
            </TabsContent>
            <TabsContent value="theme">
              <p>
                askr-themes styles the shared slots so the components look like
                part of the same app shell.
              </p>
            </TabsContent>
          </Tabs>
        </div>

        <div class="showcase-section panel">
          <h3>
            <IconLabel icon={<ListIcon size={16} />}>Accordion</IconLabel>
          </h3>
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
                  The components stay headless while askr-themes supplies the
                  skin and layout primitives.
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      <div class="showcase-section panel">
        <h3>
          <IconLabel icon={<ToggleLeftIcon size={16} />}>
            Shared state
          </IconLabel>
        </h3>
        <p class="text-muted">
          One state value drives both the toggle and the preview text.
        </p>
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
      </div>
    </>
  );
}