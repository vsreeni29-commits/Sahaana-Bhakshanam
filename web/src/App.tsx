import { Storefront } from './Storefront';
import { Admin } from './Admin';
import { Policies } from './Policies';

export function App() {
  const path = window.location.pathname;
  if (path.startsWith('/admin')) return <Admin />;
  if (path.startsWith('/policies')) return <Policies />;
  return <Storefront />;
}
