import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { factory } from '@cinerino/api-javascript-client';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Actions, ofType } from '@ngrx/effects';
import { select, Store } from '@ngrx/store';
import * as moment from 'moment';
import { Observable, race } from 'rxjs';
import { take, tap } from 'rxjs/operators';
import { IReservationSeat, Reservation, SeatStatus } from '../../../../models';
import {
    ActionTypes,
    CancelSeats,
    GetScreen,
    GetTicketList,
    SelectSeats,
    TemporaryReservation
} from '../../../../store/actions/purchase.action';
import * as reducers from '../../../../store/reducers';
import { AlertModalComponent } from '../../../parts/alert-modal/alert-modal.component';

@Component({
    selector: 'app-purchase-seat',
    templateUrl: './purchase-seat.component.html',
    styleUrls: ['./purchase-seat.component.scss']
})
export class PurchaseSeatComponent implements OnInit {
    public purchase: Observable<reducers.IPurchaseState>;
    public error: Observable<string | null>;
    public isLoading: Observable<boolean>;
    public moment = moment;
    constructor(
        private store: Store<reducers.IState>,
        private actions: Actions,
        private router: Router,
        private modal: NgbModal
    ) { }

    public async ngOnInit() {
        this.purchase = this.store.pipe(select(reducers.getPurchase));
        this.error = this.store.pipe(select(reducers.getError));
        this.isLoading = this.store.pipe(select(reducers.getLoading));
        this.getScreen();
    }

    /**
     * getScreen
     */
    private getScreen() {
        this.purchase.subscribe((purchase) => {
            const screeningEvent = purchase.screeningEvent;
            if (screeningEvent === undefined) {
                this.router.navigate(['/error']);
                return;
            }
            this.store.dispatch(new GetScreen({ screeningEvent }));
        }).unsubscribe();

        const success = this.actions.pipe(
            ofType(ActionTypes.GetScreenSuccess),
            tap(() => {
                this.getTickets();
            })
        );

        const fail = this.actions.pipe(
            ofType(ActionTypes.GetScreenFail),
            tap(() => {
                this.router.navigate(['/error']);
            })
        );
        race(success, fail).pipe(take(1)).subscribe();
    }

    /**
     * selectAll
     */
    public selectAll() {
        this.cancelAll();
        this.purchase.subscribe((purchase) => {
            const seats: IReservationSeat[] = [];
            purchase.screeningEventOffers.forEach((screeningEventOffer) => {
                screeningEventOffer.containsPlace.forEach((place) => {
                    if (place.offers === undefined
                        || place.offers[0].availability !== 'InStock'
                        || purchase.screenData === undefined) {
                        return;
                    }
                    // const findResult = purchase.screenData.hc.find(hc => hc === place.branchCode);
                    // if (findResult !== undefined) {
                    //     return;
                    // }
                    const seat = {
                        seatNumber: place.branchCode,
                        seatSection: screeningEventOffer.branchCode
                    };
                    seats.push(seat);
                });
            });
            if (purchase.authorizeSeatReservation !== undefined
                && purchase.authorizeSeatReservation.instrument !== undefined) {
                if (purchase.authorizeSeatReservation.instrument.identifier === factory.service.webAPI.Identifier.Chevre) {
                    // chevre
                    purchase.authorizeSeatReservation.object.acceptedOffer.forEach((offer) => {
                        const chevreOffer = <factory.action.authorize.offer.seatReservation.IAcceptedOffer4chevre>offer;
                        if (chevreOffer.ticketedSeat === undefined) {
                            return;
                        }
                        seats.push(chevreOffer.ticketedSeat);
                    });
                }
            }
            this.store.dispatch(new SelectSeats({ seats }));
        }).unsubscribe();

    }

    /**
     * cancelAll
     */
    public cancelAll() {
        this.purchase.subscribe((purchase) => {
            const seats = purchase.reservations.map(reservation => reservation.seat);
            this.store.dispatch(new CancelSeats({ seats }));
        }).unsubscribe();
    }

    /**
     * selectSeat
     */
    public selectSeat(data: {
        seat: IReservationSeat,
        status: SeatStatus
    }) {
        if (data.status === SeatStatus.Default) {
            this.store.dispatch(new SelectSeats({ seats: [data.seat] }));
        } else {
            this.store.dispatch(new CancelSeats({ seats: [data.seat] }));
        }
    }

    /**
     * onSubmit
     */
    public onSubmit() {
        this.purchase.subscribe((purchase) => {
            const transaction = purchase.transaction;
            const screeningEvent = purchase.screeningEvent;
            if (purchase.reservations.length === 0) {
                this.openAlert({
                    title: 'エラー',
                    body: '座席が未選択です。'
                });
                return;
            }
            const reservations = purchase.reservations.map((reservation) => {
                return new Reservation({
                    seat: reservation.seat,
                    ticket: (reservation.ticket === undefined)
                        ? { ticketOffer: purchase.screeningEventTicketOffers[0] }
                        : reservation.ticket
                });
            });
            const authorizeSeatReservation = purchase.authorizeSeatReservation;
            if (transaction === undefined
                || screeningEvent === undefined) {
                this.router.navigate(['/error']);
                return;
            }
            this.store.dispatch(new TemporaryReservation({
                transaction,
                screeningEvent,
                reservations,
                authorizeSeatReservation
            }));
        }).unsubscribe();
        const success = this.actions.pipe(
            ofType(ActionTypes.TemporaryReservationSuccess),
            tap(() => {
                this.router.navigate(['/purchase/ticket']);
            })
        );

        const fail = this.actions.pipe(
            ofType(ActionTypes.TemporaryReservationFail),
            tap(() => {
                this.error.subscribe((error) => {
                    this.openAlert({
                        title: 'エラーが発生しました',
                        body: `お手続きの途中でエラーが発生いたしました。<br>
                        お手数をおかけいたしますが、もう一度最初から操作をお願いいたします。<br>
                        ※すでに他のお客様が同じ席を選択した場合もこのエラーが表示されます。<br><br>
                        <span class="d-block p-3 border bg-white select-text">
                            <code>${error}</code>
                        </span>`
                    });
                }).unsubscribe();
            })
        );
        race(success, fail).pipe(take(1)).subscribe();
    }

    /**
     * getTickets
     */
    private getTickets() {
        this.purchase.subscribe((purchase) => {
            const screeningEvent = purchase.screeningEvent;
            const seller = purchase.seller;
            if (screeningEvent === undefined
                || seller === undefined) {
                this.router.navigate(['/error']);
                return;
            }
            this.store.dispatch(new GetTicketList({ screeningEvent, seller }));
        }).unsubscribe();

        const success = this.actions.pipe(
            ofType(ActionTypes.GetTicketListSuccess),
            tap(() => { })
        );

        const fail = this.actions.pipe(
            ofType(ActionTypes.GetTicketListFail),
            tap(() => {
                this.router.navigate(['/error']);
            })
        );
        race(success, fail).pipe(take(1)).subscribe();
    }

    public openAlert(args: {
        title: string;
        body: string;
    }) {
        const modalRef = this.modal.open(AlertModalComponent, {
            centered: true
        });
        modalRef.componentInstance.title = args.title;
        modalRef.componentInstance.body = args.body;
    }

}
