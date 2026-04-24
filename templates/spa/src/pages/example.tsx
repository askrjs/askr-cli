import { state } from '@askrjs/askr';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@askrjs/askr-ui/tabs';
import {
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionContent,
} from '@askrjs/askr-ui/accordion';
import { Toggle } from '@askrjs/askr-ui/toggle';
import { Input } from '@askrjs/askr-ui/input';
import { Flex } from '@askrjs/askr-ui/primitives/flex';
import {
  BookOpenIcon,
  CpuIcon,
  LayoutGridIcon,
  ListIcon,
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
        askr-ui headless components styled by askr-themes — working together out
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
                  import { state } from '@askrjs/askr';
                  import { Tabs, TabsList, TabsTrigger, TabsContent } from '@askrjs/askr-ui/tabs';
                  import {
                    Accordion,
                    AccordionItem,
                    AccordionHeader,
                    AccordionTrigger,
                    AccordionContent,
                  } from '@askrjs/askr-ui/accordion';
                  import { Toggle } from '@askrjs/askr-ui/toggle';
                  import { Input } from '@askrjs/askr-ui/input';
                  import { Flex } from '@askrjs/askr-ui/primitives/flex';
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
            </TabsTrigger>
            <TabsTrigger value="api">
                <IconLabel compact icon={<CpuIcon size={14} />}>API</IconLabel>
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
              <code>selector()</code>, <code>resource()</code>, and{' '}
              <code>For</code>.
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
                are updated — no virtual DOM diffing, no component re-renders.
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
        <p class="text-muted">
          Reactive state driving UI updates in real time.
        </p>
          <Flex class="example-controls" align="center" gap="var(--ak-space-md)">
          <Toggle pressed={bold()} onPress={() => setBold((b) => !b)}>
            Bold
          </Toggle>
          <Input
            placeholder="Type your name..."
            value={name()}
            onInput={(e: Event) =>
              setName((e.target as HTMLInputElement).value)
            }
          />
          </Flex>
        <p style={`font-weight: ${bold() ? '700' : '400'}`}>
          {name() ? `Hello, ${name()}!` : 'Type something above...'}
        </p>
                import { state } from '@askrjs/askr';
                import { Tabs, TabsList, TabsTrigger, TabsContent } from '@askrjs/askr-ui/tabs';
                import {
                  Accordion,
                  AccordionItem,
                  AccordionHeader,
                  AccordionTrigger,
                  AccordionContent,
                } from '@askrjs/askr-ui/accordion';
                import { Toggle } from '@askrjs/askr-ui/toggle';
                import { Input } from '@askrjs/askr-ui/input';
                import { Flex } from '@askrjs/askr-ui/primitives/flex';
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
                        askr-ui headless components styled by askr-themes — working together out
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
                              <IconLabel compact icon={<CpuIcon size={14} />}>API</IconLabel>
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
                              <code>selector()</code>, <code>resource()</code>, and{' '}
                              <code>For</code>.
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
                                are updated — no virtual DOM diffing, no component re-renders.
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
                        <p class="text-muted">
                          Reactive state driving UI updates in real time.
                        </p>
                        <Flex class="example-controls" align="center" gap="var(--ak-space-md)">
                          <Toggle pressed={bold()} onPress={() => setBold((b) => !b)}>
                            Bold
                          </Toggle>
                          <Input
                            placeholder="Type your name..."
                            value={name()}
                            onInput={(e: Event) =>
                              setName((e.target as HTMLInputElement).value)
                            }
                          />
                        </Flex>
                        <p class={bold() ? 'text-bold' : undefined}>
                          {name() ? `Hello, ${name()}!` : 'Type something above...'}
                        </p>
                      </div>
                    </>
                  );
                }
    </>
  );
}
