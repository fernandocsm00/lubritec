import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { AppProviders } from './providers';
import { routes } from './routes';

const router = createBrowserRouter(routes);

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
