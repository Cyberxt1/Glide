-- Atomic, auditable inventory updates for the Smart Stock station.

alter table public.inventory_movements
drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
add constraint inventory_movements_movement_type_check
check (movement_type in ('import', 'manual_adjustment', 'sale', 'receive', 'damage', 'return', 'stock_count'));

alter table public.inventory_movements
add column if not exists previous_quantity integer,
add column if not exists resulting_quantity integer,
add column if not exists reason text;

create or replace function public.apply_inventory_adjustments(
  target_merchant_id uuid,
  adjustments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  adjustment jsonb;
  product_row public.products%rowtype;
  operation text;
  requested_quantity integer;
  quantity_delta integer;
  next_quantity integer;
  results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(adjustments) <> 'array' or jsonb_array_length(adjustments) = 0 then
    raise exception 'Add at least one stock change.';
  end if;

  for adjustment in select value from jsonb_array_elements(adjustments)
  loop
    operation := adjustment->>'operation';
    requested_quantity := (adjustment->>'quantity')::integer;

    select * into product_row
    from public.products
    where id = (adjustment->>'product_id')::uuid
      and merchant_id = target_merchant_id
    for update;

    if not found then raise exception 'An inventory product was not found.'; end if;
    if not product_row.track_inventory then raise exception 'Inventory tracking is disabled for %.', product_row.name; end if;

    if operation = 'receive' then
      quantity_delta := requested_quantity;
    elsif operation = 'remove' then
      quantity_delta := -requested_quantity;
    elsif operation = 'count' then
      quantity_delta := requested_quantity - product_row.quantity;
    else
      raise exception 'Invalid inventory operation.';
    end if;

    next_quantity := product_row.quantity + quantity_delta;
    if next_quantity < 0 then
      raise exception 'Only % units of % are available.', product_row.quantity, product_row.name;
    end if;

    update public.products
    set quantity = next_quantity, updated_at = now()
    where id = product_row.id;

    insert into public.inventory_movements (
      merchant_id, product_id, movement_type, quantity_delta,
      previous_quantity, resulting_quantity, reason
    ) values (
      target_merchant_id,
      product_row.id,
      case operation when 'receive' then 'receive' when 'remove' then 'damage' else 'stock_count' end,
      quantity_delta,
      product_row.quantity,
      next_quantity,
      nullif(left(adjustment->>'reason', 240), '')
    );

    results := results || jsonb_build_array(jsonb_build_object(
      'productId', product_row.id,
      'name', product_row.name,
      'previousQuantity', product_row.quantity,
      'quantity', next_quantity,
      'delta', quantity_delta
    ));
  end loop;

  return results;
end;
$$;

revoke all on function public.apply_inventory_adjustments(uuid, jsonb) from public;
grant execute on function public.apply_inventory_adjustments(uuid, jsonb) to service_role;

