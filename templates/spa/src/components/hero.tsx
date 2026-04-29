import { Link, type LinkProps } from '@askrjs/askr/router';
import {
  Button,
  Flex,
  Section,
  Stack,
  type ButtonProps,
} from '@askrjs/themes/components';

type HeroProps = {
  children?: unknown;
};

type HeroTextProps = Omit<JSX.IntrinsicElements['p'], 'children'> & {
  children?: unknown;
};

type HeroTitleProps = Omit<JSX.IntrinsicElements['h1'], 'children'> & {
  children?: unknown;
};

type HeroActionsProps = Omit<JSX.IntrinsicElements['div'], 'children'> & {
  children?: unknown;
};

type HeroButtonProps = Omit<LinkProps, 'children' | 'class'> & {
  href: string;
  children?: unknown;
  class?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
};

export default function Hero({ children }: HeroProps) {
  return (
    <Section>
      <Stack gap="4">{children}</Stack>
    </Section>
  );
}

export function HeroEyebrow({ children, ...rest }: HeroTextProps) {
  return <p {...rest}>{children}</p>;
}

export function HeroTitle({ children, ...rest }: HeroTitleProps) {
  return <h1 {...rest}>{children}</h1>;
}

export function HeroDescription({
  children,
  class: className,
  ...rest
}: HeroTextProps) {
  const classes =
    [className, 'text-muted'].filter(Boolean).join(' ') || undefined;
  return (
    <p {...rest} class={classes}>
      {children}
    </p>
  );
}

export function HeroActions({ children, ...rest }: HeroActionsProps) {
  return (
    <Flex {...rest} wrap="wrap" gap="3">
      {children}
    </Flex>
  );
}

export function HeroButton({
  children,
  class: className,
  href,
  variant = 'primary',
  size = 'lg',
  ...linkProps
}: HeroButtonProps) {
  const variantClass = variant ? `hero-button--${variant}` : undefined;
  const classes = ['hero-button', variantClass, className]
    .filter(Boolean)
    .join(' ');

  return (
    <Button asChild variant={variant} size={size}>
      <Link href={href} {...linkProps} class={classes}>
        {children}
      </Link>
    </Button>
  );
}
