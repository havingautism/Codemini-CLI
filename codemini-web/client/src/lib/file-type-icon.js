const LINE_RANGE_SUFFIX = /:\d+-\d+$/;

export function fileIconLookupName(path = '') {
  const fileName = String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || '';
  return fileName.split(/[?#]/)[0].replace(LINE_RANGE_SUFFIX, '').toLowerCase();
}

function extensionIconName(fileName = '', iconMap = {}) {
  const extensions = iconMap.fileExtensions || {};
  const dotIndexes = [];
  for (let i = 0; i < fileName.length; i += 1) {
    if (fileName[i] === '.' && i > 0 && i < fileName.length - 1) dotIndexes.push(i);
  }
  for (const dotIndex of dotIndexes) {
    const iconName = extensions[fileName.slice(dotIndex + 1)];
    if (iconName) return iconName;
  }
  return '';
}

export function resolveFileTypeIconName(path = '', iconMap = {}) {
  const fileName = fileIconLookupName(path);
  return (
    iconMap.fileNames?.[fileName]
    || extensionIconName(fileName, iconMap)
    || iconMap.defaultFileIcon
    || 'file'
  );
}
