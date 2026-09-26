import { memo, useState, type ReactNode } from "react";
import { OptionDisplay } from "@bb/shared-ui/option-display";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import type { WorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import {
  MachineIcon,
  MachineLabel,
  type MachineLabelHost,
} from "@/components/machines/MachineLabel";
import type { MachineProviderPresentation } from "@/components/plugin/MachineProviderIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";

const CHECKOUT_CHIP_BASE_CLASS_NAME =
  "flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground";
const CHECKOUT_CHIP_BUTTON_CLASS_NAME = `${CHECKOUT_CHIP_BASE_CLASS_NAME} cursor-pointer transition-colors hover:bg-state-hover hover:text-foreground`;

interface ThreadEnvironmentSummaryProps {
  projectName?: string;
  environmentLabel?: string;
  environmentCompactLabel?: string;
  environmentIcon?: IconName;
  environmentProviderName?: string;
  environmentHost?: MachineLabelHost;
  environmentMachineName?: string;
  environmentMachineProvider?: MachineProviderPresentation | null;
  environmentCheckout?: WorkspaceCheckoutDisplay;
  onCreateNewThreadInEnvironment?: () => void;
}

export const ThreadEnvironmentSummary = memo(function ThreadEnvironmentSummary({
  projectName,
  environmentLabel,
  environmentCompactLabel,
  environmentIcon,
  environmentProviderName,
  environmentHost,
  environmentMachineName,
  environmentMachineProvider,
  environmentCheckout,
  onCreateNewThreadInEnvironment,
}: ThreadEnvironmentSummaryProps) {
  const isCompactViewport = useIsCompactViewport();
  if (
    !projectName &&
    !environmentLabel &&
    !environmentHost &&
    !environmentCheckout &&
    !onCreateNewThreadInEnvironment
  ) {
    return null;
  }

  const checkoutCopyValue = environmentCheckout?.copyValue ?? null;
  if (isCompactViewport) {
    return (
      <CompactThreadEnvironmentSummary
        projectName={projectName}
        environmentLabel={environmentLabel}
        environmentIcon={environmentIcon}
        environmentHost={environmentHost}
        environmentMachineName={environmentMachineName}
        environmentMachineProvider={environmentMachineProvider}
        environmentCheckout={environmentCheckout}
        onCreateNewThreadInEnvironment={onCreateNewThreadInEnvironment}
      />
    );
  }
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 pr-1.5">
      {projectName ? (
        <OptionDisplay
          label="Project"
          value={projectName}
          compactValue={projectName}
          leading={<Icon name="Folder" className="size-4 shrink-0" />}
          className="h-6 min-w-0 max-w-[10rem] shrink"
        />
      ) : null}
      {environmentHost ? (
        <MachineLabel
          host={environmentHost}
          machineProvider={environmentMachineProvider}
          className="h-6 w-fit max-w-full shrink px-1 text-xs leading-tight text-muted-foreground"
          iconClassName="size-4"
        />
      ) : environmentLabel ? (
        <div className="inline-flex h-6 w-fit max-w-full min-w-0 shrink items-center justify-start gap-1.5 px-1 text-xs leading-tight text-muted-foreground">
          {environmentIcon &&
          environmentProviderName &&
          environmentProviderName !== environmentLabel ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  role="img"
                  tabIndex={0}
                  aria-label={environmentProviderName}
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Icon name={environmentIcon} className="size-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{environmentProviderName}</TooltipContent>
            </Tooltip>
          ) : environmentIcon ? (
            <Icon
              name={environmentIcon}
              className={cn(
                "size-4 shrink-0",
                environmentIcon === "Loading" && "animate-spin",
              )}
            />
          ) : null}
          <OptionDisplay
            label="Environment"
            value={environmentLabel}
            compactValue={environmentCompactLabel}
            className="h-6 min-w-0 shrink px-0"
          />
        </div>
      ) : null}
      {environmentCheckout && checkoutCopyValue !== null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-promptbox-hide-branch-compact=""
              className={CHECKOUT_CHIP_BUTTON_CLASS_NAME}
              onClick={() => {
                void copyToClipboardWithToast(checkoutCopyValue, {
                  successMessage:
                    environmentCheckout.copySuccessMessage ?? "Value copied",
                  errorMessage:
                    environmentCheckout.copyErrorMessage ??
                    "Failed to copy value",
                });
              }}
            >
              <Icon name="GitBranch" className="size-3.5 shrink-0" />
              <span className="truncate">{environmentCheckout.label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{environmentCheckout.title}</TooltipContent>
        </Tooltip>
      ) : environmentCheckout ? (
        <span
          data-promptbox-hide-branch-compact=""
          className={CHECKOUT_CHIP_BASE_CLASS_NAME}
          title={environmentCheckout.title}
        >
          <Icon name="GitBranch" className="size-3.5 shrink-0" />
          <span className="truncate">{environmentCheckout.label}</span>
        </span>
      ) : null}
      {onCreateNewThreadInEnvironment ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="New thread in this environment"
              onClick={onCreateNewThreadInEnvironment}
              className={cn(
                "-ml-1 inline-flex cursor-pointer shrink-0 items-center justify-center rounded-md px-1 py-0.5 transition-colors hover:bg-state-hover",
                CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
              )}
            >
              <Icon name="MessageSquarePlus" className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New thread in this environment</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
});

function copyCheckout(checkout: WorkspaceCheckoutDisplay, value: string) {
  void copyToClipboardWithToast(value, {
    successMessage: checkout.copySuccessMessage ?? "Value copied",
    errorMessage: checkout.copyErrorMessage ?? "Failed to copy value",
  });
}

function CompactThreadEnvironmentSummary({
  projectName,
  environmentLabel,
  environmentIcon,
  environmentHost,
  environmentMachineName,
  environmentMachineProvider,
  environmentCheckout,
  onCreateNewThreadInEnvironment,
}: Omit<ThreadEnvironmentSummaryProps, "environmentCompactLabel">) {
  const [open, setOpen] = useState(false);
  const machineName = environmentHost?.name ?? environmentMachineName;
  const showEnvironmentRow =
    environmentLabel !== undefined && environmentLabel !== machineName;
  const machineIcon = environmentHost ? (
    <MachineIcon
      host={environmentHost}
      machineProvider={environmentMachineProvider}
      className="size-4"
    />
  ) : (
    <Icon name="Laptop" className="size-4 shrink-0" aria-hidden />
  );
  const environmentGlyph = environmentIcon ? (
    <Icon
      name={environmentIcon}
      className={cn(
        "size-4 shrink-0",
        environmentIcon === "Loading" && "animate-spin",
      )}
      aria-hidden
    />
  ) : null;
  const checkoutCopyValue = environmentCheckout?.copyValue ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        data-thread-environment-summary-trigger=""
        className="-ml-3.5 flex shrink-0 items-center"
      >
        {projectName ? (
          <EnvironmentSummaryButton
            icon={
              <Icon name="Folder" className="size-4 shrink-0" aria-hidden />
            }
            ariaLabel={`Project ${projectName}`}
          />
        ) : null}
        {machineName ? (
          <EnvironmentSummaryButton
            icon={machineIcon}
            ariaLabel={`Machine ${machineName}`}
          />
        ) : environmentLabel ? (
          <EnvironmentSummaryButton
            icon={environmentGlyph}
            ariaLabel={`Environment ${environmentLabel}`}
          />
        ) : null}
        {environmentCheckout ? (
          <EnvironmentSummaryButton
            icon={
              <Icon name="GitBranch" className="size-4 shrink-0" aria-hidden />
            }
            ariaLabel={`Branch ${environmentCheckout.label}`}
          />
        ) : null}
      </div>
      <PopoverContent mobileTitle="Thread environment" className="w-72 p-1">
        <div className="flex flex-col text-sm">
          {projectName ? (
            <EnvironmentDetailRow
              icon={<Icon name="Folder" className="size-4 shrink-0" />}
              label="Project"
              value={projectName}
            />
          ) : null}
          {machineName ? (
            <EnvironmentDetailRow
              icon={machineIcon}
              label="Machine"
              value={machineName}
            />
          ) : null}
          {showEnvironmentRow ? (
            <EnvironmentDetailRow
              icon={environmentGlyph}
              label="Environment"
              value={environmentLabel}
            />
          ) : null}
          {environmentCheckout ? (
            <EnvironmentDetailRow
              icon={<Icon name="GitBranch" className="size-4 shrink-0" />}
              label="Branch"
              value={environmentCheckout.label}
              trailing={
                checkoutCopyValue !== null ? (
                  <Icon
                    name="Copy"
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                ) : null
              }
              onSelect={
                checkoutCopyValue !== null
                  ? () => {
                      copyCheckout(environmentCheckout, checkoutCopyValue);
                      setOpen(false);
                    }
                  : undefined
              }
            />
          ) : null}
          {onCreateNewThreadInEnvironment ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreateNewThreadInEnvironment();
              }}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-state-hover"
            >
              <Icon name="MessageSquarePlus" className="size-4 shrink-0" />
              <span>New thread in this environment</span>
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EnvironmentSummaryButton({
  icon,
  ariaLabel,
}: {
  icon: ReactNode;
  ariaLabel: string;
}) {
  return (
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
      >
        {icon}
      </button>
    </PopoverTrigger>
  );
}

function EnvironmentDetailRow({
  icon,
  label,
  value,
  trailing,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  trailing?: ReactNode;
  onSelect?: () => void;
}) {
  const content = (
    <>
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {icon}
        <span className="min-w-0 break-all">{value}</span>
      </span>
      {trailing}
    </>
  );
  const rowClassName =
    "flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-left";
  if (!onSelect) {
    return <div className={rowClassName}>{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        rowClassName,
        "cursor-pointer transition-colors hover:bg-state-hover",
      )}
    >
      {content}
    </button>
  );
}
