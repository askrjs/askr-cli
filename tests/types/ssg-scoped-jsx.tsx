import type { JSX as AskrJSX } from "@askrjs/askr/jsx-runtime";
import type { JSX as AskrDevJSX } from "@askrjs/askr/jsx-dev-runtime";

const inputProps: AskrJSX.IntrinsicElements["input"] = {
  type: "text",
  value: "Scoped JSX",
};
const developmentProps: AskrDevJSX.IntrinsicElements["input"] = inputProps;
const hostProps = { id: "ssg-scoped-jsx" };

export const page: AskrJSX.Element = (
  <main {...hostProps} key="after-spread">
    <input {...developmentProps} />
    <button type="button" tabIndex={0}>
      Continue
    </button>
  </main>
);

// @ts-expect-error Native input types are strings, not arbitrary numbers.
export const invalidInput = <input type={123} />;

// @ts-expect-error Native tabIndex accepts a numeric value, not an object.
export const invalidTabIndex = <button tabIndex={{ value: 0 }} />;

// @ts-expect-error Askr JSX is scoped to its runtime; no ambient JSX shim is installed.
export type RetiredAmbientJSX = JSX.IntrinsicElements;
