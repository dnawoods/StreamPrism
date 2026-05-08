/**
 * Formats a channel name by removing common prefixes like "US:" or "US "
 */
export function formatChannelName(name: string): string {
  if (!name) return '';
  
  let formattedName = name;
  
  if (formattedName.startsWith('US: ')) {
    formattedName = formattedName.substring(4);
  } else if (formattedName.startsWith('US ')) {
    formattedName = formattedName.substring(3);
  }
  
  return formattedName;
}
