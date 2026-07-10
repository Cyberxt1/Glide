-- Store the customer's optional receipt email after payment is confirmed.

alter table public.orders
add column if not exists customer_email text;

create index if not exists orders_customer_email_idx on public.orders(customer_email);
