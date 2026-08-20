import { Inline } from '@askrjs/themes/components';

export default function PageHeader(props: {
  title: string;
  description: string;
  actions?: unknown;
}) {
  return (
    <Inline class="page-header" align="center" justify="between" wrap>
      <div class="page-header-copy">
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      {props.actions && <div>{props.actions}</div>}
    </Inline>
  );
}
