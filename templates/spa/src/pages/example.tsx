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
  CpuIcon,
  LayoutGridIcon,
  ListIcon,
  SparklesIcon,
  ToggleLeftIcon,
} from '@askrjs/askr-lucide';
import Counter from '../components/counter';
import IconLabel from '../components/icon-label';

export default function Example() {
  const [name, setName] = state('');
  const [bold, setBold] = state(false);

  return (
    <>
      <h1>Component Showcase</h1>
      <p class="text-muted">
        askr-ui headless components styled by askr-themes - working together out
        of the box.
      </p>

      <Counter />

      <div class="showcase-section">
        <h3>
          <IconLabel icon={<LayoutGridIcon size={16} />}>Tabs</IconLabel>
        </h3>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">
              <IconLabel compact icon={<SparklesIcon size={14} />}>
                Overview
              </IconLabel>
            </TabsTrigger>
            <TabsTrigger value="code">
              <IconLabel compact icon={<BookOpenIcon size={14} />}>
                Code
              </IconLabel>
            </TabsTrigger>
            <TabsTrigger value="api">
              <IconLabel compact icon={<CpuIcon size={14} />}>
                API
              </IconLabel>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <p>
              Askr uses <code>state()</code> for reactive values that
              automatically track dependencies and update only the DOM nodes
              that need to change.
            </p>
          </TabsContent>
          <TabsContent value="code">
            <p>
              Create reactive state with{' '}
              <code>const [count, setCount] = state(0)</code>, read with{' '}
              <code>count()</code>, and update with{' '}
              <code>setCount(n =&gt; n + 1)</code>.
            </p>
          </TabsContent>
          <TabsContent value="api">
            <p>
              Core primitives: <code>state()</code>, <code>derive()</code>,{' '}
              <code>selector()</code>, <code>resource()</code>, and <code>For</code>.
            </p>
          </TabsContent>
        </Tabs>
      </div>

      <div class="showcase-section">
        <h3>
          <IconLabel icon={<ListIcon size={16} />}>Accordion</IconLabel>
        </h3>
        <Accordion type="single" collapsible>
          <AccordionItem value="reactivity">
            <AccordionHeader>
              <AccordionTrigger>
                What is fine-grained reactivity?
              </AccordionTrigger>
            </AccordionHeader>
            <AccordionContent>
              <p>
                Fine-grained reactivity means updates are surgical. When a state
                value changes, only the specific DOM nodes that read that value
                are updated - no virtual DOM diffing, no component re-renders.
              </p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="ssr">
            <AccordionHeader>
              <AccordionTrigger>Does Askr support SSR?</AccordionTrigger>
            </AccordionHeader>
            <AccordionContent>
              <p>
                Yes. Askr provides <code>renderToString()</code> and{' '}
                <code>renderToStream()</code> for server-side rendering, plus{' '}
                <code>hydrateSPA()</code> for client hydration.
              </p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="themes">
            <AccordionHeader>
              <AccordionTrigger>How does theming work?</AccordionTrigger>
            </AccordionHeader>
            <AccordionContent>
              <p>
                askr-ui components emit <code>data-slot</code> attributes.
                askr-themes provides CSS that targets these slots with design
                tokens. Switch themes by changing a single CSS import.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <div class="showcase-section">
        <h3>
          <IconLabel icon={<ToggleLeftIcon size={16} />}>
            Toggle &amp; Input
          </IconLabel>
        </h3>
        <p class="text-muted">Reactive state driving UI updates in real time.</p>
        <div class="example-controls">
          <Toggle pressed={bold()} onPress={() => setBold((value) => !value)}>
            Bold
          </Toggle>
          <Input
            placeholder="Type your name..."
            onInput={(event: Event) =>
              setName((event.target as HTMLInputElement).value)
            }
          />
        </div>
        <p style={`font-weight: ${bold() ? '700' : '400'}`}>
          {name() ? `Hello, ${name()}!` : 'Type something above...'}
        </p>
      </div>
    </>
  );
}