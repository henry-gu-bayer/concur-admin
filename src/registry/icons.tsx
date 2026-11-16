import { CoinsIcon } from '@phosphor-icons/react/dist/csr/Coins';
import { FileMagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/FileMagnifyingGlass';
import { GlobeIcon } from '@phosphor-icons/react/dist/csr/Globe';
import { IdentificationCardIcon } from '@phosphor-icons/react/dist/csr/IdentificationCard';
import { ListDashesIcon } from '@phosphor-icons/react/dist/csr/ListDashes';
import { MapPinIcon } from '@phosphor-icons/react/dist/csr/MapPin';
import { ReceiptIcon } from '@phosphor-icons/react/dist/csr/Receipt';
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack';
import { UserIcon } from '@phosphor-icons/react/dist/csr/User';

const iconProps = { size: 20, 'aria-hidden': true } as const;

/** Each feature uses the same icon in the directory and sidebar. */
export const icons = {
  lists: <StackIcon {...iconProps} />,
  forms: <IdentificationCardIcon {...iconProps} />,
  'expense-config': <CoinsIcon {...iconProps} />,
  locations: <MapPinIcon {...iconProps} />,
  localities: <GlobeIcon {...iconProps} />,
  reports: <ReceiptIcon {...iconProps} />,
  users: <UserIcon {...iconProps} />,
  'sae-check': <FileMagnifyingGlassIcon {...iconProps} />,
  'api-logs': <ListDashesIcon {...iconProps} />,
};
