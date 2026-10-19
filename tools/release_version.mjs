export function resolveReleaseVersion({requestedVersion, refType, refName}) {
  const tagged = refType === 'tag';
  const version = tagged && refName?.startsWith('v') ? refName.slice(1) : requestedVersion;
  if (tagged && (!refName?.startsWith('v') || requestedVersion && requestedVersion !== version))
    throw Error('The release input and v-prefixed tag must designate the same version.');
  if (typeof version !== 'string' || version.trim() !== version || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/u.test(version))
    throw Error('A strict SemVer release version without a v prefix or build metadata is required.');
  return version;
}
