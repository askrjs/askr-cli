import { Case, For, Match } from '@askrjs/askr/control';
import { Skeleton } from '@askrjs/themes/components';
import EmptyState from './empty-state';
import { joinClasses } from '../utils/join-classes';

export type DataTableColumn<Row> = {
  key: string;
  header: unknown;
  class?: string;
  render: (row: Row) => unknown;
};

export default function DataTable<Row>(props: {
  rows: () => Row[];
  rowKey: (row: Row) => string;
  columns: DataTableColumn<Row>[];
  class?: string;
  tableClass?: string;
  rowClass?: (row: Row) => string | undefined;
  isLoading?: boolean;
  errorText?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const rows = props.rows();
  const table = (
    <div class={joinClasses('table-wrap', props.class)}>
      <table class={props.tableClass}>
        <thead>
          <tr>
            <For each={props.columns} by={(column) => column.key}>
              {(column) => <th class={column.class}>{column.header}</th>}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows} by={props.rowKey}>
            {(row: Row) => (
              <tr class={props.rowClass?.(row)}>
                <For each={props.columns} by={(column) => column.key}>
                  {(column) => (
                    <td class={column.class}>{column.render(row)}</td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );

  return (
    <Case fallback={table}>
      <Match when={props.errorText}>
        <EmptyState
          title="Could not load table"
          description={props.errorText ?? 'The table could not be loaded.'}
        />
      </Match>
      <Match when={props.isLoading}>
        <div
          class={joinClasses('panel stack-sm', props.class)}
          aria-hidden="true"
        >
          <Skeleton class="skeleton-line" />
          <Skeleton class="skeleton-line" />
          <Skeleton class="skeleton-line" />
        </div>
      </Match>
      <Match when={rows.length === 0}>
        <EmptyState
          title={props.emptyTitle ?? 'No rows found'}
          description={
            props.emptyDescription ??
            'Try changing filters or adding new records.'
          }
        />
      </Match>
    </Case>
  );
}
