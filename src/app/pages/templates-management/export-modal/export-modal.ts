import { Component, computed, inject, input, output, signal } from "@angular/core";

import { ExchangeDocument } from "../../../core/models/template-exchange.model";
import { TemplateExchangeService } from "../../../core/services/template-exchange.service";
import { FormattedPayload } from "../../../shared/formatted-payload/formatted-payload";
import { Modal } from "../../../shared/modal/modal";

const TITLES: Record<ExchangeDocument["kind"], string> = {
  template: "Export Template",
  collection: "Export Collection",
  bundle: "Export All Templates",
};

/** Shows a single template/collection/bundle as copy-pasteable JSON,
 * per `spec/template-format-v1.md` - the one modal reused for all three
 * export actions on the Templates page, since the only difference between
 * them is which `ExchangeDocument` gets built beforehand. */
@Component({
  selector: "app-export-modal",
  imports: [Modal, FormattedPayload],
  templateUrl: "./export-modal.html",
  styleUrl: "./export-modal.css",
})
export class ExportModal {
  readonly document = input.required<ExchangeDocument>();
  readonly close_modal = output<void>();

  private readonly templateExchange = inject(TemplateExchangeService);

  readonly copied = signal(false);

  readonly title = computed(() => TITLES[this.document().kind]);
  readonly serialized = computed(() =>
    this.templateExchange.serialize(this.document()),
  );

  async copyToClipboard(): Promise<void> {
    await navigator.clipboard.writeText(this.serialized());
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}
