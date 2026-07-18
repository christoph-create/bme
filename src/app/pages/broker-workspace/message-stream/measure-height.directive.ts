import { Directive, ElementRef, OnDestroy, OnInit, inject, output } from "@angular/core";

/**
 * Reports this host element's rendered height (`offsetHeight`) whenever it
 * changes. Used to correct a virtualized list's estimated row heights to
 * real measurements once a row actually renders.
 *
 * No-ops in environments without `ResizeObserver` (e.g. the jsdom test
 * environment) - callers just keep using their estimated height.
 */
@Directive({ selector: "[appMeasureHeight]" })
export class MeasureHeight implements OnInit, OnDestroy {
  readonly heightChange = output<number>();

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private observer: ResizeObserver | null = null;

  ngOnInit(): void {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    this.observer = new ResizeObserver(() => {
      this.heightChange.emit(this.elementRef.nativeElement.offsetHeight);
    });
    this.observer.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
