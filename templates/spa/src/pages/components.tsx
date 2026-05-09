import { state } from "@askrjs/askr";
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from "@askrjs/ui/composites/accordion";
import { Input } from "@askrjs/ui/primitives/input";
import { Toggle } from "@askrjs/ui/primitives/toggle";
import { BookOpenIcon, ListIcon, SparklesIcon, ToggleLeftIcon } from "@askrjs/lucide";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Grid,
  Inline,
  Section,
} from "@askrjs/themes/components";
import Counter from "../components/counter";

export default function Components() {
  const name = state("");
  const bold = state(false);

  return (
    <>
      <Section>
        <section class="page-header components-hero">
          <div class="page-header-copy">
            <p class="marketing-eyebrow">Components</p>
            <h1>A few controls, a little state, nothing more.</h1>
            <p class="marketing-lead text-muted">
              This page keeps the demo intentionally small: accordion, toggle, and one shared state
              value driving two controls.
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
                  <SparklesIcon size={16} />
                  <span>Composition</span>
                </Inline>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div class="stack gap-3">
                <p>
                  <Inline as="span" align="center" gap="1">
                    <SparklesIcon size={14} />
                    <strong>Reactive</strong>
                  </Inline>
                </p>
                <p>
                  <code>state()</code> updates only the parts of the page that read the current
                  value.
                </p>
                <p>
                  <Inline as="span" align="center" gap="1">
                    <BookOpenIcon size={14} />
                    <strong>Composition</strong>
                  </Inline>
                </p>
                <p>askr-ui provides the structure while the app chooses how much UI to assemble.</p>
              </div>
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
                      The goal is to show a believable app surface, not every control in the design
                      system.
                    </p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="reactivity">
                  <AccordionHeader>
                    <AccordionTrigger>Where is the reactivity?</AccordionTrigger>
                  </AccordionHeader>
                  <AccordionContent>
                    <p>The counter and the input row both update live from local state.</p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="styling">
                  <AccordionHeader>
                    <AccordionTrigger>What provides the styling?</AccordionTrigger>
                  </AccordionHeader>
                  <AccordionContent>
                    <p>
                      The components stay headless while askr-themes supplies the skin and layout
                      primitives.
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
                onInput={(event: Event) => name.set((event.target as HTMLInputElement).value)}
              />
            </div>
            <p style={`font-weight: ${bold() ? "700" : "400"}`}>
              {name() ? `Hi, ${name()}!` : "Type a name to update the preview."}
            </p>
          </CardContent>
        </Card>
      </Section>
    </>
  );
}
