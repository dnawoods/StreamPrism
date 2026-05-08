import { useEffect, useState } from 'react';

export function useKeyboardNavigation() {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Find all focusable elements with a data-nav attribute
      const elements = Array.from(document.querySelectorAll('[data-nav-id]')) as HTMLElement[];
      if (elements.length === 0) return;

      const currentIndex = elements.findIndex(el => el.getAttribute('data-nav-id') === focusedId);
      
      let nextIndex = currentIndex;

      switch (e.key) {
        case 'ArrowDown':
          nextIndex = (currentIndex + 1) % elements.length;
          break;
        case 'ArrowUp':
          nextIndex = (currentIndex - 1 + elements.length) % elements.length;
          break;
        case 'Enter':
          if (currentIndex !== -1) {
            elements[currentIndex].click();
          }
          break;
        case 'Backspace':
        case 'Escape':
          // Can be used to go back or close modals
          break;
      }

      if (nextIndex !== currentIndex) {
        const nextId = elements[nextIndex].getAttribute('data-nav-id');
        setFocusedId(nextId);
        elements[nextIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedId]);

  return { focusedId, setFocusedId };
}
