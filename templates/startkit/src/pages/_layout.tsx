import '../styles.css';
import {
  ToastHost,
  Toast,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
} from '@askrjs/ui/toast';
import {
  clearToast,
  bindToast,
  setToastOpen,
  toastMessage,
  toastOpen,
} from '../toast';
import { state } from '@askrjs/askr';

export default function App({ children }: { children?: unknown }) {
  const [messageState, setMessageState] = state(toastMessage());
  const [openState, setOpenState] = state(toastOpen());

  bindToast({
    setMessage: setMessageState,
    setOpen: setOpenState,
  });

  const messageTitle = () => messageState()?.title ?? '';
  const messageDescription = () => messageState()?.description;

  return (
    <ToastHost duration={2400}>
      <div class="app-root">{children}</div>

      <ToastViewport class="app-toast-viewport" />
      {messageState() && (
        <Toast
          open={openState()}
          onOpenChange={(open) => {
            setToastOpen(open);
            if (!open) {
              clearToast();
            }
          }}
          class="app-toast"
        >
          <ToastTitle>{messageTitle()}</ToastTitle>
          {messageDescription() && (
            <ToastDescription>{messageDescription()}</ToastDescription>
          )}
          <ToastClose aria-label="Dismiss notification">Dismiss</ToastClose>
        </Toast>
      )}
    </ToastHost>
  );
}
