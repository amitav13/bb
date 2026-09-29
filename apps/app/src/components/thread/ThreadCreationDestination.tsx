import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import type { ThreadCreationPlacement } from "@/lib/thread-creation-placement";

export function ThreadCreationDestination({
  placement,
  onChange,
  sections,
}: {
  placement: ThreadCreationPlacement;
  onChange: (placement: ThreadCreationPlacement) => void;
  sections: readonly { id: string; name: string }[];
}) {
  const section = sections.find(
    (section) => section.id === placement.sectionId,
  );
  const label =
    section?.name ??
    (placement.sectionId === null ? "Threads" : "Section unavailable");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="mb-2 self-start text-muted-foreground"
          variant="ghost"
          size="sm"
          aria-label="Thread destination"
        >
          {placement.pinned ? `Pinned · ${label}` : label}
          <Icon name="ChevronDown" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" mobileTitle="Thread destination">
        <DropdownMenuItem
          onSelect={() => onChange({ ...placement, pinned: !placement.pinned })}
        >
          {placement.pinned ? "Unpin new thread" : "Pin new thread"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onChange({ ...placement, sectionId: null })}
        >
          Threads
        </DropdownMenuItem>
        {sections.map((section) => (
          <DropdownMenuItem
            key={section.id}
            onSelect={() => onChange({ ...placement, sectionId: section.id })}
          >
            {section.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
