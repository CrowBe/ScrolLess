interface Props {
  saved: boolean;
  onToggle: () => void;
}

export function SaveButton({ saved, onToggle }: Props) {
  return (
    <button
      class={`card__save${saved ? ' card__save--active' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={saved ? 'Remove from saved' : 'Save item'}
    >
      <span
        class="material-symbols-outlined"
        style={saved ? 'font-variation-settings: "FILL" 1' : ''}
      >
        bookmark
      </span>
    </button>
  );
}
